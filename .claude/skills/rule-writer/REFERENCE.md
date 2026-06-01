# Rule Writer — 注入脚本参考模板

## fetch 拦截模板

```js
var _fetch = window.fetch;
window.fetch = function(input, init) {
  var url = typeof input === 'string' ? input : (input && input.url) || '';
  var method = (init && init.method) || (input && input.method) || 'GET';
  var body = serializeBody((init && init.body) || (input && input.body));

  // --- 命中逻辑 ---
  var entry = findEntry(url, method, body);
  if (entry) {
    console.log('[perfsim:rule-id] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1).slice(0, 80));
    return Promise.resolve(new Response(entry.body, {
      status: entry.status,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
  return _fetch.apply(this, arguments);
};
```

## XHR 拦截模板

```js
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
    console.log('[perfsim:rule-id] HIT ' + method + ' ' + url.slice(url.lastIndexOf('/') + 1));
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
```

## serializeBody 工具函数（必须包含）

```js
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
```

## 相对 URL 归一化（必须包含）

```js
function normalize(s) { return (s || '').replace(/\s/g, ''); }

function makeKey(url, method, body) {
  if (url && !url.startsWith('http')) url = location.origin + url;
  return (method || 'GET').toUpperCase() + ':' + url + ':' + normalize(body);
}
```

## isApiRequest 过滤器（analyze 阶段用）

```js
function isApiRequest(req) {
  const ct = req.responseHeaders?.['content-type'] ?? req.responseHeaders?.['Content-Type'] ?? ''
  return ct.includes('application/json')
}
```

## 请求对象字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 完整 URL |
| `method` | string | GET/POST 等 |
| `requestBody` | string | POST body，字符串形式 |
| `startTime` | number | CDP timestamp * 1000，毫秒 |
| `endTime` | number | 同上，loadingFailed 时为 undefined |
| `status` | number | HTTP 状态码 |
| `responseHeaders` | object | 响应头，注意大小写不统一 |
| `responseBody` | string | 响应体，仅 shouldCache=true 时有值 |
| `cacheKey` | string | `METHOD:url:md5(body)`，录制时生成 |
| `source` | string | `'network'` / `'sw-cache'` |
| `shouldCache` | boolean | responseBodySize <= 500KB 时为 true |

## severity 判断惯例

```js
const severity = issues.length > 0
  ? (wastedMs >= 500 ? 'high' : 'medium')
  : 'info'
```

## 注入脚本包裹格式

`buildScript` 返回的字符串会被 `buildInjectionScript()` 包在一个外层 IIFE 里，
所以规则内部可以直接写平铺代码，也可以自己再套一层 IIFE 隔离变量：

```js
// 推荐：用 IIFE 隔离，防止多规则变量污染
return `;(function(){
  // ... 你的代码
})();`
```
