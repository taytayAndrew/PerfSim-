# PerfSim 工程难点与解决过程

> 记录 PerfSim MVP 开发中遭遇的真实技术难点、排查路径和最终解法。每一个问题都不是"读文档能找到答案"的那种——需要对工具链的底层原理有足够的认知才能定位。

---

## 难点一：Lighthouse 指标全部上涨——根因竟然不是优化没效果

### 现象

推演结束后，before/after 对比显示 LCP、FCP、TTI **全部上涨**（如从 2100ms 涨到 3800ms）。无论怎么调整规则逻辑，结果都不变。第一直觉是"优化脚本没生效"，但换了个思路想：如果 before 和 after 测的根本不是同一个页面，指标就会完全无意义。

### 排查路径

1. 在 Lighthouse 运行前后打印页面截图 → 发现 **before 截到的是登录页**，after 截到的才是真实应用
2. 根本原因：Cookie 注入方式错误

Cookie 注入有两种 API：
- `page.setCookie()`：只对当前 Page 对象生效
- CDP `Network.setCookie`：浏览器 profile 级别，对所有 tab 生效

原始代码用 `page.setCookie()`，但 Lighthouse 运行时会**新建自己的 tab**（`browser.newPage()`），新 tab 没有 Cookie，SSO 重定向到登录页。登录页加载极快（没有真正的 LCP 元素），所以 before 的 LCP 数值看起来很低。After 才因为某个路径恢复了 Cookie，测到了真实页面，数值反而"涨上去了"。

### 解法

统一改为 CDP `Network.setCookie`，在浏览器网络层注入，对所有 tab 生效：

```js
const tempPage = await browser.newPage()
const client = await tempPage.createCDPSession()
for (const c of cookies) {
  await client.send('Network.setCookie', { name: c.name, value: c.value, domain: c.domain, ... })
}
await tempPage.close()
```

### 闪光点

问题表面看是"优化没效果"，实际是"before/after 根本没测同一个东西"。能跳出"优化脚本有没有问题"的思维定势，转而质疑"测量环境本身是否对称"，是这次排查的关键转折。

---

## 难点二：串行链检测始终返回空——NaN 的隐式传播

### 现象

`analyze()` 里 `findings` 始终为 `[]`，但 Network 面板明确能看到串行请求链。日志显示规则运行了，但没有任何 chain 被检测到。

### 排查路径

1. 打印 `recording.requests` → 发现部分请求的 `endTime` 是 `undefined`（来自 `Network.loadingFailed` 事件，没有 `responseReceivedTime`）
2. `chain-analyzer.js` 里的比较：`B.startTime <= A.endTime + 150` → 如果 `A.endTime` 是 `undefined`，结果是 `NaN`
3. `NaN` 参与任何比较都返回 `false`，导致所有"B 是否由 A 驱动"的判断全部失败
4. 链就此断掉，深度永远为 1，全部过滤掉

### 解法

在 `chain-analyzer.js` 入口增加过滤，排除 `endTime` 为 null/undefined 的请求：

```js
const networkRequests = requests.filter(r =>
  r.url && !r.url.startsWith('data:') && !r.url.startsWith('blob:') &&
  r.startTime != null && r.endTime != null
)
```

### 闪光点

NaN 的隐式传播是 JavaScript 里最隐蔽的 bug 之一——`undefined + 150` 得到 `NaN`，`NaN <= 200` 得到 `false`，整个比较逻辑静默失败，没有任何报错。定位这个问题需要对数据流的每个字段都有怀疑精神，不能假设"字段一定存在"。

---

## 难点三：注入脚本静默失败——SyntaxError 在 evaluateOnNewDocument 里无法冒泡

### 现象

`buildScript()` 生成的脚本理论上应该拦截 fetch/XHR，但 Lighthouse 测量前后 LCP 无任何变化。Server 日志没有 `[perfsim] HIT` 字样。

### 排查路径

1. 加了 `page.on('console')` 监听 → 没有 `[perfsim] script loaded` 日志输出
2. 直接 `console.log(buildScript(...))` 把脚本内容打印出来 → 发现结尾有两个 `})();`：

```js
;(function(){
  // ...
})();   // IIFE 正常闭合
})();   // 多余！模板字符串拼接时残留的闭合符
```

3. 这是一个语法错误，浏览器在 `evaluateOnNewDocument` 阶段**静默丢弃**整个脚本，不抛出任何可观察的错误事件

### 解法

修复模板字符串，删除多余的 `})();`。同时建立调试规范：**注入脚本第一行必须是 `console.log('[perfsim] script loaded')`**，作为"脚本存活"的心跳检测——如果 server 日志里看不到这行，说明脚本根本没运行，无需继续排查逻辑问题。

### 闪光点

`evaluateOnNewDocument` 的 SyntaxError 是完全静默的——没有 `page.on('pageerror')`，没有 uncaught rejection，连 DevTools console 里也看不到（因为脚本在 document 创建之前就失败了）。识别出"这是一个可观察性盲区"，并主动设计心跳日志来填补这个盲区，是这次排查的工程亮点。

---

## 难点四：Lighthouse simulate 模式让优化效果完全消失

### 现象

注入脚本修复后，`[perfsim] HIT` 日志正常出现，说明拦截生效了。但 LCP 改善几乎为零（before: 2100ms，after: 2080ms）。

### 排查路径

1. 看 Lighthouse 源码中 `metric.js` 的分支逻辑：

```js
switch (settings.throttlingMethod) {
  case 'simulate':  return this.computeSimulatedMetric(...)  // Lantern 重建时序
  case 'provided':  return this.computeObservedMetric(...)   // 信任实测时间
}
```

2. `simulate` 模式下 Lighthouse 启用 **Lantern** 图模型——它收集 CDP 网络 trace，然后**重新建模所有请求的时序**，完全不信任实际观测到的请求时间
3. 我们的 fetch 拦截让请求在 0ms 内返回，但 Lantern 看到的 trace 里仍然是原来的 RTT，计算出的 LCP 和没有优化一样
4. 换言之：`simulate` 模式对我们的拦截方案**天然免疫**，根本无法测量注入脚本的效果

### 解法

before/after 统一改用 `throttlingMethod: 'provided'`，让 Lighthouse 直接上报实测时间，不经过 Lantern 重算：

```js
const settings = {
  throttlingMethod: 'provided',   // 信任实测，不用 Lantern
  throttling: { rttMs: 0, throughputKbps: 0, cpuSlowdownMultiplier: 1 },
}
```

为对冲 `provided` 模式的网络抖动，改为**跑 3 次取中位数**。

### 闪光点

这个问题需要读 Lighthouse 源码才能定位，光看文档是找不到的。能想到"也许不是脚本问题，而是 Lighthouse 压根没用实测时间"，并能在源码层面验证这个假设，体现了对工具链底层原理的掌握深度。

---

## 难点五：SEED 方案导致 LCP 从 863ms 飙升到 5200ms

### 背景

重复请求去重规则的 `buildScript()` 最初用 **SEED 方案**：把录制时的响应体直接嵌入注入脚本，模拟阶段所有重复请求直接从脚本内的缓存返回。

### 现象

首次模拟正常（LCP 863ms）。第二次运行同一份录制，LCP 暴涨到 5200ms。

### 根因分析

SEED 数据是**录制时刻**的快照，包含了那次 HTTP Session 的状态：
- JWT token（录制时的，模拟时已失效）
- 服务端 Session ID（可能已过期）
- 时间戳字段、版本号等动态数据

模拟阶段用新浏览器实例打开页面，第一个真实请求（登录态校验）能通过，但后续 SEED 返回了旧 Session 的数据。应用代码读到过期 token → 触发重新登录流程 → 页面进入异常状态 → LCP 元素迟迟无法渲染。

### 解法

改用 **WHITELIST 运行时缓存**方案：

- WHITELIST = 录制中出现重复的 `{url, method, body}` 三元组
- 注入脚本只拦截 WHITELIST 里的 URL，但**不预置任何响应数据**
- 第一次请求**必须真实走网络**，响应成功后缓存到内存 `CACHE`
- 第二次及以后命中 CACHE，即时返回

```js
// 第一次：走网络，缓存响应
if (inWhitelist(url, method, body)) {
  promise.then(res => {
    res.clone().text().then(text => { CACHE[key] = { body: text, status: res.status } })
  })
}
// 第二次：命中 CACHE，即时返回
if (CACHE[key]) {
  return Promise.resolve(new Response(CACHE[key].body, { status: CACHE[key].status, ... }))
}
```

### 闪光点

问题的关键不是"缓存命中了没有"，而是"缓存的是什么"——旧的静态数据在新 Session 里语义已经失效，但不会报错，只会让应用进入隐蔽的异常状态。发现"响应体里可能带有 Session 级别的动态状态"并设计出 WHITELIST 运行时方案（永远用当次 Session 的真实响应），是这次迭代的核心架构决策。

---

## 难点六：并行重复 vs 串行重复——一个看似简单但容易踩坑的判断

### 问题

"重复请求"有两种形态：
1. **并行重复**：A 和 B 几乎同时发出，A 还没返回时 B 已在飞行中
2. **串行重复**：A 返回后，B 才发出（通常因为 A 的响应触发了 B 的渲染）

只有串行重复才是性能问题——删掉 B，用 A 的缓存代替，LCP 可以提前。并行重复删掉 B 不影响总时长（A 和 B 同时在飞，总等待时间由 A 决定），反而减少了服务器压力，不属于前端性能优化范畴。

### CDP 时间戳误差

CDP 采样有约 ±10ms 的时间戳误差。一个串行重复可能因此被误判为并行：

```
A.endTime   = 200ms（实际可能是 205ms）
B.startTime = 198ms（实际是 A 返回后触发的，但 CDP 记录比 A.endTime 早 2ms）
```

如果直接判断 `B.startTime >= A.endTime`，这个 pair 会被漏掉。

### 解法

引入 `SERIAL_TOLERANCE_MS = 20` 容差：

```js
function hasSerialDuplicate(group) {
  const first = group[0]
  return group.slice(1).some(r => r.startTime >= first.endTime - SERIAL_TOLERANCE_MS)
}
```

B 的 startTime 比 A 的 endTime 最多早 20ms，仍然认为是串行驱动（覆盖 JSON.parse + setState 的耗时误差）。

### 闪光点

区分并行和串行重复需要真正理解"删掉这个请求，LCP 会不会变"——这是性能优化的本质问题，不是代码层面的判断。同时识别出 CDP 时间戳误差的影响并给出合理容差，体现了对 Chrome DevTools Protocol 底层行为的了解。

---

## 难点七：可插拔规则架构——让 PerfSim 不只是一个串行链检测器

### 问题

随着去重规则的加入，前端结论组件完全写死了"串行链"的逻辑——标题、卡片格式、结论文案都是硬编码的。每新增一个规则，就要改前端代码。

### 解法

设计**可插拔规则契约**：每个规则文件是一个自包含的模块，负责：
1. `analyze()` — 分析录制数据，返回 `findings`
2. `calculateTheoretical()` — 估算理论节省时间
3. `buildScript()` — 生成注入脚本
4. `buildCard(finding, index)` — **声明自己的卡片展示格式**

```js
// rule-dedup-requests.js
export function buildCard(finding, index) {
  return {
    title: `重复请求 #${index + 1}`,
    badge: `${finding.length} 次调用 · 可节省 ${savedMs}ms`,
    rows: finding.map((r, i) => ({
      label: i === 0 ? '首次调用' : `重复调用 #${i}`,
      ms: Math.round(r.endTime - r.startTime),
      url: r.url,
      highlight: i > 0,   // 重复调用标红
    }))
  }
}
```

前端只需要一个通用 `FindingCard` 组件消费 `{ title, badge, rows[] }` 结构，不需要知道背后是串行链还是重复请求。

`Conclusion` 组件也从"硬编码串行链文案"改为读 `sim.rules[]`，按规则的 severity/ruleName/summary 动态生成推演结论。

### 闪光点

这是一个架构层面的决策：**分析逻辑 + 注入脚本 + 展示格式**三者都内聚在规则文件里，PerfSim 本身只是一个运行框架。新增规则不需要改任何框架代码，只需新建一个规则文件并实现契约方法。这种设计让 PerfSim 从一个专用工具变成了一个可扩展的性能推演平台。

---

---

## 难点八：Express 5 + ESM top-level await 导致进程启动后立即退出

### 现象

`node src/index.js` 打印启动日志后进程立即退出，Server 无法保持运行，没有任何报错。

### 根因

Express 5 将 `app.listen()` 改为返回 `Promise`（Express 4 返回的是 `http.Server`）。`index.js` 是 ESM 模块，支持 top-level `await`。

Node.js 的行为：当 ESM 模块顶层代码执行完毕且事件循环无 pending 任务时，进程退出。`app.listen()` 在 Express 5 里变成了 Promise，**不 `await` 它就等于调用后立即丢弃**——事件循环没有任何挂起的异步操作，进程认为任务已完成，自动退出。

### 解法

用 `Promise` 包裹 `http.Server.listen()`，`await` 它使进程持续挂起：

```js
// 修复前
app.listen(PORT, () => { console.log('Server started') })

// 修复后
await new Promise((resolve, reject) => {
  const server = app.listen(PORT, () => resolve(server))
  server.on('error', reject)
})
```

### 闪光点

这个 bug 的迷惑性在于：进程"正常"退出，没有 uncaught exception，日志看起来也正常。需要理解 Node.js 事件循环的退出条件（无 pending I/O / timer / Promise），以及 Express 5 的 breaking change，才能快速定位。不熟悉这两个知识点的人会花大量时间怀疑端口冲突、环境变量、ESM 配置等无关方向。

---

## 难点九：CDP Cookie 注入的三层 API——同一功能三种实现，只有一种真正有效

### 背景

PerfSim 需要在 Puppeteer 中注入 Cookie 让 SSO 页面正常加载。Cookie 注入有三种 API 路径，名字相近但作用域完全不同。

### 三种 API 的实质差异

| API | 写入位置 | 对 Lighthouse 内部 tab 生效？ |
|-----|----------|-------------------------------|
| page-level CDP `Network.setCookie` | Chrome 内部虚拟 NetworkContext（per-page） | ❌ 不生效 |
| `page.setCookie()` | 浏览器真实 Cookie jar（browser-level） | ✅ 生效 |
| browser-level CDP `Network.setCookie` | 浏览器真实 Cookie jar | ✅ 生效 |

`page.setCookie()` 内部走的是 Browser-level CDP session，写入浏览器真实 Cookie jar，所有 tab 共享。而 page-level CDP session 的 `Network.setCookie` 写入的是 Chrome 内部的虚拟 NetworkContext，浏览器发请求时完全不读这个 store。

这个 bug 在三个模块（RecordingEngine、LighthouseRunner、SimulationEngine）里各自独立踩了一次，因为每个模块的作者（开发阶段）都做了同一个错误假设："我能读到 Cookie（`Network.getAllCookies` 有结果），说明注入成功了"。

### 解法

所有模块统一：先 `goto(origin)` 建立真实的浏览器上下文，再用 `page.setCookie()` 写入。

```js
const tempPage = await browser.newPage()
await tempPage.goto(origin, { waitUntil: 'domcontentloaded' }).catch(() => {})
await tempPage.setCookie(...puppeteerCookies)
await tempPage.close()
```

### 闪光点

这个问题的核心陷阱在于：`Network.getAllCookies` 从同一个虚拟 NetworkContext 读，所以"写进去"和"读出来"都成功，但浏览器发请求时走的是真实 Cookie jar，两者互不相通。**"能读到"和"请求携带"是两个完全不同的数据路径**——能识别出这个区分，需要对 Chrome 网络栈和 CDP 协议的内部分层有具体认知。

---

## 难点十：动态接口检测粒度错误——URL 级别 vs cacheKey 三元组级别

### 现象

规则识别出 28 条串行链，但 `buildScript` 只生成了 5 条 ENTRIES，绝大多数请求没有被缓存，注入脚本几乎是空操作，优化效果为零。

### 根因

`buildScript` 用 `METHOD:URL` 为粒度判断"是否为动态接口"：只要同一 URL 出现过多个不同 requestBody，整个 URL 就被排除。

真实场景：`POST /getSubTree` 被调 13 次，每次传不同的 `dimension` 参数（`ACCOUNT`、`DAY`、`MONTH`...），每个参数对应的响应是固定的。这 13 个请求实际上是 13 个**确定性的三元组**，每个都可以安全缓存。但 URL 粒度的检测把它们全部一刀切排除了。

### 解法

改为以 `cacheKey`（`METHOD:URL:md5(body)`）为粒度建索引：

```js
// 修复前：URL 粒度——同 URL 出现多个 body 就全排除
const bodyIndex = {}  // "METHOD:url" → Set of requestBodies
if (bodies.size > 1) skip

// 修复后：cacheKey 粒度——只有同一输入返回不同输出才排除
const cacheKeyIndex = {}  // cacheKey → Set of responseBodies
if (responsesForKey.size > 1) skip  // 服务端对相同输入返回了不同输出 = 真正动态
```

### 闪光点

问题的本质是**可缓存性的判断维度**：不是"这个 URL 是否动态"，而是"这个具体的（URL+method+body）三元组，响应是否确定"。前者是粗糙的 URL 视角，后者才是正确的接口语义视角。将判断粒度从 URL 精化到 cacheKey，ENTRIES 数量从 5 条增加到 28 条，优化效果质变。

---

## 难点十一：URLSearchParams body 序列化不一致，XHR 拦截全部 MISS

### 现象

注入脚本 `ENTRIES` 里有 `POST /getConfig`（requestBody = `action=getCompany`），但 simulate 阶段 XHR 拦截全部 MISS，没有任何 HIT 日志，LCP 无改善。

### 根因

页面代码用 `new URLSearchParams({ action: 'getCompany' })` 作为 body 发请求。注入脚本 XHR 拦截里的 body 处理：

```js
var b = typeof body === 'string' ? body : ''
```

`URLSearchParams` 的 `typeof` 是 `object`，不是 `string`，直接变成空字符串 `''`。而 ENTRIES 里存的是 `action=getCompany`。两者永远不匹配，所有用 URLSearchParams 发送的请求全部 MISS。

fetch 拦截有类似问题：用 `JSON.stringify` 处理 URLSearchParams，把它序列化成 `"{}"`（URLSearchParams 没有可枚举属性）。

CDP 录制时，浏览器在发出 XHR/fetch 请求前会先将 URLSearchParams 序列化为 `key=value&...` 格式的字符串，**拦截脚本必须做同样的序列化**才能与 ENTRIES 里的 requestBody 匹配。

### 解法

新增 `serializeBody()` 函数，精确模拟 CDP 录制时浏览器的序列化行为：

```js
function serializeBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString(); // "key=value&..."
  if (body instanceof FormData) {
    var parts = [];
    body.forEach(function(v, k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
    return parts.join('&');
  }
  try { return JSON.stringify(body); } catch(e) { return String(body); }
}
```

### 闪光点

问题的核心在于：**录制时浏览器做了序列化，注入脚本必须做完全相同的序列化**，两者才能在 string 层面对齐。不理解"CDP 录制 postData 时浏览器已经序列化过一次"这个细节，根本不会想到序列化不一致是问题所在。

---

## 难点十二：loginRedirect 误判——应用 URL 本身含 login 关键词

### 现象

目标页面 URL 为 `/hdb/login/home#/designModelSheet2/...`，每次录制都被判定为 `loginRedirect: true`，Server 直接返回 401，用户无法使用。但页面实际加载完全正常。

### 根因

loginRedirect 检测基于字符串关键词：`finalUrl.includes('login')`。目标应用的路由设计中，`/login/` 是业务模块路径的一部分（类似 `/login/home` 表示"登录后的首页"），不代表"被重定向到登录页"。

单纯的关键词匹配无法区分两种场景：
1. 正常访问：`/app/login/home`（业务路由，含 login）
2. 被重定向：`/auth/login?redirect=...`（真正的登录页）

### 解法

改为对比**意图路径 vs 最终路径**的差异，且仅当目标路径本身**不含** login 关键词、但最终路径**含有**时才判定为跳转：

```js
const pathChanged = !finalPath.startsWith(intendedPath.split('/').slice(0, 3).join('/'))
const hasLoginKeyword = /\/(login|signin|auth)\b/i.test(finalPath)
  && !/\/(login|signin|auth)\b/i.test(intendedPath)
const loginRedirect = pathChanged && hasLoginKeyword
```

### 闪光点

这是一个"用户视角 vs 业务路由实际结构"的错配问题。技术上关键词匹配看起来合理，但真实的企业内部系统路由命名完全不遵循"约定俗成"——`/login/home` 对用户来说是"登录后的工作台"，对检测逻辑来说却是"登录页"。识别出这类"通用假设在真实业务场景下失效"的情况，并设计出基于路径变化 + 路径对比的更鲁棒判断，是这次修复的亮点。

---

## 总结

| 难点 | 核心能力 |
|------|----------|
| Express 5 进程立即退出 | Node.js 事件循环退出条件 + 框架 breaking change 意识 |
| CDP Cookie 注入三层 API 区分 | Chrome 网络栈内部分层，CDP 协议层级差异 |
| LighthouseRunner 测登录页（指标全涨） | 质疑测量环境对称性，而非只怀疑优化逻辑 |
| NaN 隐式传播断链 | 防御性数据编程，不信任上游字段 |
| 注入脚本静默 SyntaxError | 主动设计可观察性（心跳日志填补盲区） |
| Lantern 吃掉优化效果 | 读 Lighthouse 源码，理解模拟 vs 实测的本质差异 |
| SEED 旧数据破坏新 Session | 识别响应体的时态语义（快照数据在新 Session 里失效） |
| 并行/串行重复的正确区分 | 从性能影响反推判断逻辑，CDP 时间戳误差建模 |
| 动态接口检测粒度错误 | 可缓存性判断：URL 视角 vs cacheKey 三元组视角 |
| URLSearchParams 序列化不一致 | CDP 录制行为与注入脚本必须保持序列化对称 |
| loginRedirect 误判 | 通用假设在真实业务路由下失效，路径对比替代关键词匹配 |
| 可插拔规则架构 | 内聚 vs 耦合的架构判断，面向扩展设计 |

每一个问题的共同点：**表面现象和根因之间隔着至少一层非直觉的间接性**。能在信息不完整的情况下建立假设、设计验证手段、找到真正的根因，是这个项目最核心的工程能力体现。
