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

## 总结

| 难点 | 核心能力 |
|------|----------|
| Cookie 注入导致测同一个页面 | 对 Puppeteer/CDP API 层级差异的理解 |
| NaN 隐式传播断链 | 数据防御性编程，不信任上游字段 |
| 注入脚本静默 SyntaxError | 主动设计可观察性（心跳日志） |
| Lantern 吃掉优化效果 | 读 Lighthouse 源码，理解模拟 vs 实测的本质差异 |
| SEED 旧数据破坏新 Session | 识别数据的时态语义（快照 vs 动态） |
| 并行/串行重复的正确区分 | 从性能影响反推判断逻辑，而不是从代码层面想当然 |
| 可插拔规则架构 | 内聚 vs 耦合的架构判断，面向扩展设计 |

每一个问题的共同点：**表面现象和根因之间隔着至少一层非直觉的间接性**。能在信息不完整的情况下建立假设、设计验证手段、找到真正的根因，是这个项目最核心的工程能力体现。
