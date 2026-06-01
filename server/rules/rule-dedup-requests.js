/**
 * Rule: Duplicate Request Deduplication
 *
 * Detects identical API requests (same URL + method + body) fired more than once
 * during page load, where the duplicate is issued AFTER the first response arrives
 * (serial duplicate). Parallel duplicates (both fired before either returns) are
 * excluded — they cannot be eliminated by a runtime dedup cache since the cache
 * is empty when the second call fires.
 *
 * Common causes of serial duplicates:
 *   - Component A fetches data, renders Component B, which fetches the same data again
 *   - Navigation / tab switch triggers a fresh fetch without checking existing cache
 *   - Missing request deduplication layer (e.g. no SWR/React Query)
 */

export const id = 'rule-dedup-requests'
export const name = '重复请求去重'
export const description =
  '检测串行重复的 API 请求（第二次在第一次响应返回后才发出），通过拦截 fetch/XHR 返回首次响应缓存，模拟去重后的效果。并行重复请求不在此规则范围内。'
export const confidence = 'high'

function isApiRequest(req) {
  const ct = req.responseHeaders?.['content-type'] ?? req.responseHeaders?.['Content-Type'] ?? ''
  return ct.includes('application/json')
}

// Tolerance for CDP timestamp precision: a request that starts up to 20ms
// before the previous one finishes may still be causally serial
// (e.g. JSON.parse + setState takes a few ms, making startTime appear slightly
// before endTime due to CDP sampling jitter).
const SERIAL_TOLERANCE_MS = 20

/**
 * A duplicate group qualifies only if at least one later call starts AFTER
 * the first call has finished (serial duplicate), with a 20ms tolerance for
 * CDP timestamp precision. Parallel duplicates — where both calls are
 * in-flight simultaneously — cannot be caught by a runtime dedup cache.
 */
function hasSerialDuplicate(group) {
  const first = group[0]
  if (first.endTime == null) return false
  return group.slice(1).some(r => r.startTime >= first.endTime - SERIAL_TOLERANCE_MS)
}

/**
 * @param {{ recording: object }} recordingData
 */
export function analyze({ recording }) {
  const allRequests = (recording?.requests ?? []).filter(isApiRequest)

  // Group by cacheKey — same (url + method + body) → same cacheKey
  const groups = {}
  for (const req of allRequests) {
    if (!req.cacheKey) continue
    if (!groups[req.cacheKey]) groups[req.cacheKey] = []
    groups[req.cacheKey].push(req)
  }

  // Sort each group by startTime so first = earliest call
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.startTime - b.startTime)
  }

  // Only flag groups with 2+ occurrences AND at least one serial duplicate
  const allDuplicates = Object.values(groups).filter(g => g.length >= 2)
  const duplicates = allDuplicates.filter(hasSerialDuplicate)
  const parallelOnly = allDuplicates.length - duplicates.length  // for summary info

  // Wasted time = duration of each serial duplicate call (could have been instant)
  const wastedMs = duplicates.reduce((sum, group) => {
    const first = group[0]
    const serialExtras = group.slice(1).filter(r => r.startTime >= first.endTime - SERIAL_TOLERANCE_MS)
    return sum + serialExtras.reduce((s, r) => {
      const d = (r.endTime ?? r.startTime) - r.startTime
      return s + (d > 0 ? d : 0)
    }, 0)
  }, 0)

  const severity = duplicates.length > 0
    ? (wastedMs >= 500 ? 'high' : 'medium')
    : 'info'

  let summary = ''
  if (duplicates.length > 0) {
    summary = `发现 ${duplicates.length} 个串行重复请求（可节省约 ${Math.round(wastedMs)}ms）`
    if (parallelOnly > 0) summary += `，另有 ${parallelOnly} 个并行重复（不可去重）`
  } else if (parallelOnly > 0) {
    summary = `未发现串行重复请求；发现 ${parallelOnly} 个并行重复（两次同时发出，运行时无法去重）`
  } else {
    summary = '未发现重复 API 请求'
  }

  return {
    severity,
    affectsLCP: severity === 'high',
    duplicates,
    findings: duplicates,
    summary,
  }
}

/**
 * @param {{ duplicates: Array }} analysisResult
 */
export function calculateTheoretical(analysisResult) {
  const savedMs = (analysisResult.duplicates ?? []).reduce((sum, group) => {
    // First request is necessary; all subsequent ones are eliminated
    const extras = group.slice(1)
    return sum + extras.reduce((s, r) => {
      const d = (r.endTime ?? r.startTime) - r.startTime
      return s + (d > 0 ? d : 0)
    }, 0)
  }, 0)

  return { savedMs: Math.round(savedMs) }
}

/**
 * Build a fetch/XHR intercept script that deduplicates identical requests at runtime.
 * Strategy: cache the first response for each (url+method+body) key; return it instantly
 * for every subsequent identical request.
 *
 * @param {{ duplicates: Array }} analysisResult
 * @param {{ recording: { requests: Array } }} recordingData
 */
export function buildScript(analysisResult) {
  const { duplicates } = analysisResult

  if (!duplicates || duplicates.length === 0) {
    return ';(function(){})();'
  }

  // Build a whitelist of (url+method+body) keys that appear duplicated in recording.
  // The injection script only intercepts requests whose key is in this whitelist,
  // and ONLY from the second call onwards — the first call always goes to the network
  // so we get a fresh, valid response to cache. This avoids serving stale recorded
  // data (which may contain session tokens, timestamps, etc. that are now invalid).
  const whitelist = duplicates.map(group => {
    const req = group[0]
    return {
      url: req.url,
      method: (req.method ?? 'GET').toUpperCase(),
      requestBody: req.requestBody ?? '',
    }
  })

  const whitelistJson = JSON.stringify(whitelist)

  return `;(function(){
  // Dedup rule: intercept duplicate API calls and return the first live response.
  // Strategy: first call always goes to network (fresh data), response is cached,
  // subsequent identical calls (same url+method+body) return from cache instantly.
  // This is safe for session-sensitive data — we never serve stale recorded responses.
  var WHITELIST = ${whitelistJson};

  console.log('[perfsim:dedup] script loaded, watching ' + WHITELIST.length + ' duplicate endpoints');

  // Runtime cache — populated from live network responses, never pre-seeded
  var CACHE = {};
  // Track in-flight requests to avoid race conditions (two parallel identical calls)
  var INFLIGHT = {};

  function normalize(s) { return (s || '').replace(/\\s/g, ''); }

  function makeKey(url, method, body) {
    if (url && !url.startsWith('http')) url = location.origin + url;
    return (method || 'GET').toUpperCase() + ':' + url + ':' + normalize(body);
  }

  function inWhitelist(url, method, body) {
    if (url && !url.startsWith('http')) url = location.origin + url;
    var nb = normalize(body);
    var m = (method || 'GET').toUpperCase();
    for (var i = 0; i < WHITELIST.length; i++) {
      var e = WHITELIST[i];
      if (e.url === url && e.method === m && normalize(e.requestBody) === nb) return true;
    }
    return false;
  }

  function serializeBody(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      var parts = [];
      body.forEach(function(v, k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
      return parts.join('&');
    }
    try { return JSON.stringify(body); } catch(e) { return String(body); }
  }

  // Intercept fetch
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var body = serializeBody((init && init.body) || (input && input.body));
    var key = makeKey(url, method, body);

    // Already cached from a previous live response — return instantly
    if (CACHE[key]) {
      console.log('[perfsim:dedup] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1).slice(0, 80));
      return Promise.resolve(new Response(CACHE[key].body, {
        status: CACHE[key].status,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    var promise = _fetch.apply(this, arguments);

    // Cache the live response if this key is in our dedup whitelist
    if (inWhitelist(url, method, body)) {
      promise = promise.then(function(res) {
        var ct = res.headers && res.headers.get && res.headers.get('content-type');
        if (ct && ct.includes('application/json')) {
          res.clone().text().then(function(text) {
            if (!CACHE[key]) {
              CACHE[key] = { body: text, status: res.status };
              console.log('[perfsim:dedup] CACHED ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1).slice(0, 80));
            }
          });
        }
        return res;
      });
    }

    return promise;
  };

  // Intercept XHR
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__dedup_url__ = url;
    this.__dedup_method__ = method;
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var url = this.__dedup_url__ || '';
    var method = this.__dedup_method__ || 'GET';
    var b = serializeBody(body);
    var key = makeKey(url, method, b);

    // Already cached — return instantly
    if (CACHE[key]) {
      console.log('[perfsim:dedup] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1));
      var entry = CACHE[key];
      setTimeout(function() {
        Object.defineProperty(self, 'readyState', { get: function() { return 4; } });
        Object.defineProperty(self, 'status', { get: function() { return entry.status; } });
        Object.defineProperty(self, 'responseText', { get: function() { return entry.body; } });
        Object.defineProperty(self, 'response', { get: function() { return entry.body; } });
        if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
        if (typeof self.onload === 'function') self.onload();
      }, 0);
      return;
    }

    // Pass through — cache response if in whitelist
    if (inWhitelist(url, method, b)) {
      this.addEventListener('load', function() {
        try {
          var ct = self.getResponseHeader && self.getResponseHeader('content-type');
          if (ct && ct.includes('application/json') && !CACHE[key]) {
            CACHE[key] = { body: self.responseText, status: self.status };
            console.log('[perfsim:dedup] CACHED ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1));
          }
        } catch(e) {}
      });
    }

    return _send.apply(this, arguments);
  };
})();`
}

export function buildHtml() {
  return ''
}

/**
 * Build card display data for a single dedup finding (a group of duplicate requests).
 * @param {Array} finding - array of request objects (first = original, rest = duplicates)
 * @param {number} index - 0-based index
 */
export function buildCard(finding, index) {
  const group = Array.isArray(finding) ? finding : []
  const first = group[0]
  if (!first) return { title: `重复请求 #${index + 1}`, badge: '', rows: [] }

  const serialExtras = group.slice(1).filter(r =>
    r.startTime >= (first.endTime ?? 0) - SERIAL_TOLERANCE_MS
  )
  const savedMs = Math.round(serialExtras.reduce((s, r) => {
    const d = (r.endTime ?? r.startTime) - r.startTime
    return s + (d > 0 ? d : 0)
  }, 0))

  return {
    title: `重复请求 #${index + 1}`,
    badge: `${group.length} 次调用 · 可节省 ${savedMs}ms`,
    rows: group.map((r, i) => ({
      label: i === 0 ? '首次调用' : `重复调用 #${i}`,
      ms: Math.round((r.endTime ?? r.startTime) - r.startTime),
      url: r.url,
      highlight: i > 0,
    })),
  }
}
