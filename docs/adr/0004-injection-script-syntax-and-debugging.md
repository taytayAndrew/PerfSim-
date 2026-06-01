# ADR 0004：注入脚本语法校验与调试标准

**日期**：2026-05-25  
**状态**：已采纳

## 背景

`rule-serial-chain.js` 的 `buildScript()` 函数通过 JavaScript 模板字符串拼接注入脚本。注入脚本在页面加载前通过 `evaluateOnNewDocument` 执行，用于拦截 fetch/XHR。

## 问题

模板字符串结尾多了一个多余的 `})();`，导致生成的脚本语法错误：

```js
// buildScript() 生成的内容：
;(function(){
  var ENTRIES = [...];
  // ... fetch/XHR 拦截代码 ...
})();   // ← 正确闭合 IIFE
})();   // ← 多余！SyntaxError
```

浏览器执行时直接抛出 `SyntaxError`，**整个脚本不运行**。

直接后果：
- `console.log('[perfsim] script loaded')` 从未输出
- fetch/XHR 拦截从未生效
- before/after LCP 数值几乎无差异（优化效果为零）
- `page.on('console')` 没有捕获到任何 `[perfsim]` 日志，误导排查方向

同时还发现 `var entry = findEntry(url, method, body)` 被重复声明（`var` 不会报错，但是冗余代码）。

## 决策

1. 修复模板字符串结尾，确保只有一个 `})();`
2. 删除重复的 `var entry` 声明
3. 建立调试标准：注入脚本的第一行必须是 `console.log('[perfsim] script loaded, ENTRIES=' + ENTRIES.length)`，作为脚本执行的心跳检测。如果 server 日志里没有 `PAGE: [perfsim] script loaded`，说明脚本没有执行。

## 排查经验

脚本注入问题难以排查的根本原因：

1. `evaluateOnNewDocument` 注册在 Puppeteer page 上，但 Lighthouse 用的是同一个 page（传入第 4 个参数时）
2. `page.on('console')` 监听的是该 page 的 console events
3. 如果脚本有语法错误，浏览器会静默失败（没有 uncaught error 事件冒泡到 page level）
4. 唯一可靠的验证方式：看 server 日志里是否有 `[perfsim] script loaded`

## 影响

- 注入脚本修复后，fetch/XHR 拦截开始生效
- 配合 ADR 0002（改用 `provided` 模式），before/after 差值才能真实反映优化效果
- 后续任何 `buildScript()` 修改都需要先用 `node -e` 或测试脚本验证生成内容的语法
