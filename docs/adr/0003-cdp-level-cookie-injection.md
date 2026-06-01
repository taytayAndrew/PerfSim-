# ADR 0003：所有 Lighthouse 运行使用 CDP 级别的 Cookie 注入

**日期**：2026-05-25  
**状态**：已采纳

## 背景

PerfSim 对需要登录态的页面运行 Lighthouse（SSO Cookie 认证）。每次 Lighthouse 内部执行页面导航时，都必须携带有效的 Cookie。

## 问题

**`page.setCookie()` 只对单个 Page 对象生效。** Lighthouse 在运行时会自行管理导航流程：

- 不传 `page` 参数时：Lighthouse 调用 `puppeteer.connect()` + `browser.newPage()` 新建 tab，新 tab 没有 Cookie
- 传入 `page` 参数时：Lighthouse 先导航到 `about:blank`（`navigation-runner.js` 第 ~50 行），再导航到目标 URL，SSO 重定向可能导致 Cookie 丢失

**SimulationEngine 原有的 bug**：使用 `page.setCookie(...puppeteerCookies)`——只作用于单个 tab。导致 Lighthouse 控制的 tab 加载了 SSO 登录页（没有 LCP 元素），触发 `LanternError: NO_LCP`，整次推演数据完全无效。

**LighthouseRunner 已经是正确做法**：通过临时 CDP Session 调用 `client.send('Network.setCookie', ...)`，在浏览器 profile 级别设置 Cookie，对所有 tab 生效。

SimulationEngine 漏掉了这一点。

## 决策

**LighthouseRunner 和 SimulationEngine 都统一使用 CDP `Network.setCookie`（浏览器级别）注入 Cookie。**

实现方式：

```js
const tempPage = await browser.newPage()
const client = await tempPage.createCDPSession()
for (const c of cookies) {
  await client.send('Network.setCookie', { name, value, domain, path, ... })
}
await tempPage.close()
```

## 理由

- CDP `Network.setCookie` 在浏览器的网络层设置 Cookie，对所有 tab 都有效
- 这也是 Chrome DevTools 自身注入 Cookie 的方式
- 不依赖 Lighthouse 内部使用哪个 tab

## 影响

- before 和 after 两次 Lighthouse 运行都能拿到正确的 Cookie
- 消除了因 Cookie 缺失引起的 `LanternError: NO_LCP` 错误
- 每次运行额外创建再关闭一个临时 tab（开销可忽略，约 50ms）
