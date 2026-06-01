/**
 * Rule: Serial Request Chain Parallelization
 *
 * Detects serial request chains with depth > 2 (length >= 3).
 * Simulates parallelization by intercepting fetch/XHR and returning
 * cached responses instantly — eliminating the serial wait time.
 */

import { findSerialChains } from '../src/chain-analyzer.js'

export const id = 'rule-serial-chain'
export const name = '串行请求链并行化'
export const description =
  '检测深度 > 2 的串行请求链，通过拦截 fetch/XHR 直接返回缓存响应，模拟串行变并行的效果。'
export const confidence = 'medium'

const MIN_CHAIN_DEPTH = 2  // depth > 1 means length >= 2

// Only treat requests as part of a serial API chain if their response is JSON.
// Static assets (JS/CSS/images/fonts/HTML) load serially due to normal browser
// parse-then-discover behavior — that's expected, not a serial chain bug.
function isApiRequest(req) {
  const ct = req.responseHeaders?.['content-type'] ?? req.responseHeaders?.['Content-Type'] ?? ''
  return ct.includes('application/json')
}

/**
 * @param {{ recording: object, chains: Array }} recordingData
 */
export function analyze({ recording, chains = [] }) {
  // Build chains from only API (JSON) requests — avoids static asset and tracking noise
  // polluting what looks like a serial chain.
  const allRequests = recording?.requests ?? []
  const apiRequests = allRequests.filter(isApiRequest)
  const apiChains = findSerialChains(apiRequests)

  const qualified = apiChains.filter(chain => {
    const requests = Array.isArray(chain) ? chain : chain.requests
    return Array.isArray(requests) && requests.length >= MIN_CHAIN_DEPTH
  })

  const maxDelay = qualified.reduce((max, chain) => {
    const requests = Array.isArray(chain) ? chain : chain.requests
    if (!requests || requests.length < 2) return max
    const totalDelayMs = requests[requests.length - 1].endTime - requests[0].startTime
    return Math.max(max, totalDelayMs)
  }, 0)

  const severity = qualified.length > 0 ? (maxDelay >= 500 ? 'high' : 'medium') : 'info'

  return {
    severity,
    affectsLCP: severity === 'high',
    findings: qualified,
    summary: qualified.length > 0
      ? `发现 ${qualified.length} 条深度 > 2 的串行链，最大延迟 ${Math.round(maxDelay)}ms`
      : '未发现深度 > 2 的串行请求链',
  }
}

/**
 * @param {{ chains: Array }} analysisResult
 */
export function calculateTheoretical(analysisResult) {
  const savedMs = (analysisResult.findings ?? []).reduce((sum, chain) => {
    // Save = time from end of first request to end of last request
    const requests = Array.isArray(chain) ? chain : chain.requests
    if (!requests || requests.length < 2) return sum
    const first = requests[0]
    const last = requests[requests.length - 1]
    return sum + Math.max(0, last.endTime - first.endTime)
  }, 0)

  return { savedMs: Math.round(savedMs) }
}

/**
 * Build a fetch/XHR intercept script.
 * For each URL in serial chains that has a cached responseBody,
 * intercept the request and return the cached response instantly.
 *
 * @param {{ chains: Array }} analysisResult
 * @param {{ recording: { requests: Array } }} recordingData
 */
export function buildScript(analysisResult, recordingData) {
  const { findings } = analysisResult

  if (!findings || findings.length === 0) {
    return ';(function(){})();'
  }

  const recording = recordingData?.recording ?? recordingData
  const recordedRequests = recording?.requests ?? []

  // Build a responseBody lookup keyed by cacheKey (METHOD:URL:md5(body)).
  // This lets us cache multiple distinct (url, method, body) triples for the same URL —
  // e.g. POST /getSubTree with body {"dimension":"ACCOUNT"} and body {"dimension":"DAY"}
  // are two separate, deterministic entries and can both be safely cached.
  //
  // A triple is "dynamic" (unsafe to cache) only when the SAME (url+method+body) appears
  // in the recording with DIFFERENT response bodies — meaning the server returned different
  // data for identical inputs (e.g. a timestamp or token embedded in the response).
  const cacheKeyIndex = {}  // cacheKey → Set of responseBody values seen
  for (const r of recordedRequests) {
    if (!r.cacheKey || !r.responseBody) continue
    if (!cacheKeyIndex[r.cacheKey]) cacheKeyIndex[r.cacheKey] = new Set()
    cacheKeyIndex[r.cacheKey].add(r.responseBody)
  }

  const cacheMap = {}
  const dynamicUrls = new Set()  // URLs skipped because they're dynamic

  for (const chain of findings) {
    const requests = Array.isArray(chain) ? chain : chain.requests
    if (!Array.isArray(requests)) continue
    // Skip first request (it's the initiator), cache the rest
    for (let i = 1; i < requests.length; i++) {
      const req = requests[i]

      // Find the full recorded request (has cacheKey + responseBody)
      const recorded = recordedRequests.find(r =>
        r.url === req.url && r.startTime === req.startTime
      ) ?? recordedRequests.find(r =>
        r.url === req.url && r.cacheKey && r.responseBody &&
        (r.requestBody ?? '') === (req.requestBody ?? '')
      ) ?? (req.responseBody ? req : null)
      if (!recorded || !recorded.responseBody || !recorded.cacheKey) continue

      // If the same (url+method+body) produced different responses → truly dynamic, skip
      const responsesForKey = cacheKeyIndex[recorded.cacheKey]
      if (responsesForKey && responsesForKey.size > 1) {
        dynamicUrls.add(req.url)
        continue
      }

      cacheMap[recorded.cacheKey] = {
        url: recorded.url,
        method: (recorded.method ?? 'GET').toUpperCase(),
        requestBody: recorded.requestBody ?? '',
        body: recorded.responseBody,
        status: recorded.status ?? 200,
      }
    }
  }

  // Expose which URLs were skipped as dynamic (for reporting to the user)
  analysisResult.dynamicUrls = [...dynamicUrls]

  const cacheEntries = Object.entries(cacheMap)
  if (cacheEntries.length === 0) {
    return ';(function(){})();'
  }

  // CACHE is keyed by cacheKey. The intercept must compute the same key at runtime.
  // cacheKey format: METHOD:URL:md5(body) — we use a simple string hash for the body
  // since we can't run md5 in the browser without a library.
  // Instead, store entries as an array and match by url+method+normalizedBody.
  const entriesJson = JSON.stringify(
    cacheEntries.map(([key, e]) => ({
      url: e.url,
      method: e.method,
      requestBody: e.requestBody,
      body: e.body,
      status: e.status,
    }))
  )

  return `;(function(){
  var ENTRIES = ${entriesJson};

  console.log('[perfsim] script loaded, ENTRIES=' + ENTRIES.length);

  function normalize(s) { return (s || '').replace(/\\s/g, ''); }

  function findEntry(url, method, body) {
    method = (method || 'GET').toUpperCase();
    // Normalize relative URLs to absolute — page code often sends '/api/...' but
    // recorded URLs are always absolute ('https://domain/api/...'). Without this,
    // every XHR with a relative URL would be a MISS even when the entry exists.
    if (url && !url.startsWith('http')) {
      url = location.origin + url;
    }
    var nb = normalize(body);
    for (var i = 0; i < ENTRIES.length; i++) {
      var e = ENTRIES[i];
      if (e.url === url && e.method === method && normalize(e.requestBody) === nb) return e;
    }
    // Fallback: match url+method only if no body ambiguity
    var urlMatches = ENTRIES.filter(function(e) { return e.url === url && e.method === method; });
    if (urlMatches.length === 1) return urlMatches[0];
    // Log misses for any URL that matches one of our cached entries
    var isTarget = ENTRIES.some(function(e) { return e.url === url; });
    if (isTarget) {
      console.log('[perfsim] MISS url=' + url.slice(0, 100) + ' method=' + method + ' bodyLen=' + (body||'').length);
      var match = ENTRIES.find(function(e) { return e.url === url; });
      if (match) {
        console.log('[perfsim] ENTRY bodyLen=' + match.requestBody.length + ' methodMatch=' + (match.method === method));
        console.log('[perfsim] bodyEq=' + (normalize(match.requestBody) === nb));
        if (normalize(match.requestBody) !== nb) {
          console.log('[perfsim] ENTRY body[:80]=' + match.requestBody.slice(0,80));
          console.log('[perfsim] REQ   body[:80]=' + (body||'').slice(0,80));
        }
      }
    }
    return null;
  }

  // Serialize a request body to string the same way the RecordingEngine sees it.
  // CDP records postData as a string — URLSearchParams/FormData are serialized to
  // their string representation by the browser before sending. We must do the same.
  function serializeBody(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      // FormData serializes to multipart — CDP records the raw string; best-effort match
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
    var entry = findEntry(url, method, body);
    if (entry) {
      console.log('[perfsim] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1).slice(0, 80));
      return Promise.resolve(new Response(entry.body, {
        status: entry.status,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    return _fetch.apply(this, arguments);
  };

  // Intercept XHR
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__perfsim_url__ = url;
    this.__perfsim_method__ = method;
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var url = this.__perfsim_url__ || '';
    var method = this.__perfsim_method__ || 'GET';
    var b = serializeBody(body);
    var entry = findEntry(url, method, b);
    if (entry) {
      console.log('[perfsim] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1));
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
    return _send.apply(this, arguments);
  };
})();`
}

/**
 * No HTML injection needed for this rule — it uses JS interception, not preload.
 */
export function buildHtml() {
  return ''
}

/**
 * Build card display data for a single serial chain finding.
 * @param {Array} finding - array of request objects in the chain
 * @param {number} index - 0-based index
 */
export function buildCard(finding, index) {
  const requests = Array.isArray(finding) ? finding : finding.requests ?? []
  const totalMs = requests.length >= 2
    ? Math.round(requests[requests.length - 1].endTime - requests[0].startTime)
    : 0
  const savedMs = requests.length >= 2
    ? Math.round(requests[requests.length - 1].endTime - requests[0].endTime)
    : 0

  return {
    title: `串行链 #${index + 1}`,
    badge: `${requests.length} 个请求 · 总耗时 ${totalMs}ms · 可节省 ${savedMs}ms`,
    rows: requests.map((r, i) => ({
      label: i === 0 ? '发起请求' : `第 ${i + 1} 跳`,
      ms: Math.round((r.endTime ?? r.startTime) - r.startTime),
      url: r.url,
      highlight: i > 0,
    })),
  }
}
