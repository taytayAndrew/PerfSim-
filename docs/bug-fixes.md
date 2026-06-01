# PerfSim Bug 修复记录

## BUG-01｜Express 5 进程自动退出

**现象**：`node src/index.js` 打印启动日志后立即退出，Server 无法保持运行。

**原因**：Express 5 将 `app.listen()` 改为返回 `Promise`。`index.js` 是 ESM 顶层 `await` 模块，未 `await` 该 Promise 时 Node.js 认为模块执行完毕，事件循环无 pending 任务，进程直接退出。

**修复**：用 `new Promise` 包裹 `http.Server.listen()`，`await` 它使进程持续挂起。

```js
// 修复前
app.listen(PORT, () => { console.log(...) })

// 修复后
await new Promise((resolve, reject) => {
  const server = app.listen(PORT, () => { resolve(server) })
  server.on('error', reject)
})
```

---

## BUG-02｜串行链详情全部显示 0ms 延迟

**现象**：报告页串行链列表每条都显示「0ms 总延迟」，请求列表为空。

**原因**：`sanitizeChains()` 返回的是纯数组格式 `[req1, req2, ...]`，但 `ChainCard` 组件读取的是 `chain.requests`，格式不匹配，`requests` 永远为空数组，totalMs 永远为 0。

**修复**：`ChainCard` 兼容两种格式。

```ts
// 修复前
const requests = chain.requests ?? []

// 修复后
const requests = Array.isArray(chain) ? chain : (chain.requests ?? [])
```

---

## BUG-03｜有 N 条串行链但结论显示"未发现优化空间"的矛盾

**现象**：报告显示「串行请求链 42 条」，但结论却是「建议排查后端/网络」。

**原因**：`analyzeResult.chains` 是全量串行链（含 JS/CSS/图片等静态资源，正常浏览器解析顺序造成），`rule.chains` 才是规则层认定可优化的 JSON API 串行链。结论用规则层，显示用全量层，两者来源不同。

**修复**：报告优先展示规则层 API 串行链；规则层无结果时才 fallback 到全量链。

---

## BUG-04｜登录跳转时 Server 继续跑完并返回"正常"结果

**现象**：Cookie 失效时 Puppeteer 录制到的是登录页，但 Server 继续跑完所有步骤，返回 savedMs=0 + "建议排查后端"结论，用户完全不知道数据是脏的。

**原因**：`loginRedirect: true` 时 Server 只是把字段透传给客户端，没有中断流程。

**修复**：`/api/analyze` 和 `/api/simulate` 录制完成后立即检查 `loginRedirect`，为 true 则返回 401 报错。

```js
if (recording.loginRedirect) {
  return res.status(401).json({ error: 'LOGIN_REDIRECT: Cookie 已失效...' })
}
```

---

## BUG-05｜用户重置/登录跳转后点重试仍报"已有推演任务在运行"

**现象**：登录跳转或用户手动点重置后，再次点分析页面，收到 423「已有推演任务在运行」。

**原因**：SW 收到 `LOGIN_REDIRECT` 或 `RESET` 时只改了自己的状态为 idle/error，Server 端 SessionManager 的锁没有释放，Puppeteer 任务还在跑。

**修复**：
- Server 新增 `POST /api/cancel`，调用 `sessionManager.releaseLock()`
- SW 在 `LOGIN_REDIRECT` 和 `RESET` 时都先调用 `cancelServerTask()`

---

## BUG-06｜RecordingEngine Cookie 注入无效，页面始终跳登录

**现象**：`Injecting 6 cookies via CDP` 日志出现，Cookie 也能被 `Network.getAllCookies` 读到，但实际请求头里 Cookie 是 `(none)`，页面每次都跳登录。

**原因**：`Network.setCookie`（page-level CDP session）写入的是 Puppeteer 内部的虚拟 NetworkContext，不是浏览器渲染进程真实的 Cookie jar。`Network.getAllCookies` 也从同一个虚拟 context 读，所以显示"保存成功"，但浏览器发请求时根本不读这个 store。

**修复**：先导航到目标域根路径建立 origin context，再用 `page.setCookie()` 写入浏览器真实 Cookie jar。

```js
// 修复前：CDP setCookie，在 about:blank 时调用，无效
await client.send('Network.setCookie', { ... })

// 修复后：先导航建立 origin context，再 setCookie
await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
await page.setCookie(...puppeteerCookies)
```

---

## BUG-07｜loginRedirect 误判：应用 URL 本身含 "login" 关键词

**现象**：目标页面 URL 为 `/hdb/login/home#/designModelSheet2/...`，每次录制都被判定为 `loginRedirect: true`，实际上页面加载完全正常。

**原因**：loginRedirect 检测用字符串关键词匹配（`url.includes('login')`），无法区分"应用本身的路由路径含 login"和"真正被重定向到登录页"两种情况。

**修复**：改为对比目标路径和最终路径的差异，且仅当目标路径本身不含 login 关键词、但最终路径含有时才判定为跳转。

```js
const pathChanged = !finalPath.startsWith(intendedPath.split('/').slice(0, 3).join('/'))
const hasLoginKeyword = /\/(login|signin|auth)\b/i.test(finalPath)
  && !/\/(login|signin|auth)\b/i.test(intendedPath)
const loginRedirect = pathChanged && hasLoginKeyword
```

---

## BUG-08｜注入脚本 ENTRIES 只有 14 条而非全部链

**现象**：规则发现 42 条串行链，但 `buildScript` 只生成了 14 条 ENTRIES。

**原因**：同一 URL+method 在录制中出现了多次不同 requestBody，被判定为"动态接口"跳过缓存（防止用错误数据响应）。这些接口每次请求体不同（含时间戳、动态参数），无法安全缓存。

**影响**：这是正确行为，不是 bug。动态接口在报告中通过 `dynamicUrls` 字段标注提示用户。

---

## BUG-09｜注入脚本 HIT 率为零

**现象**：`script loaded, ENTRIES=14`，但全程没有任何 `HIT` 日志，LCP 未改善。

**根本原因**：由 BUG-06（Cookie 未注入）和 BUG-07（loginRedirect 误判）共同导致。录制阶段拿到的是登录页数据，responseBody 为空，cacheEntries 实际为 0，注入脚本是空操作。修复 BUG-06/07 后需重新验证。

---

## BUG-11｜SimulationEngine Cookie 注入同款问题

**现象**：SimulationEngine 使用 CDP `Network.setCookie`（page-level）注入 Cookie，和 BUG-06 完全相同的代码路径。注释错误地认为"page.setCookie() 只影响单标签页"，实际上 page.setCookie() 写的是浏览器级别 cookie store，所有标签页（包括 Lighthouse 内部 tab）共享。

**原因**：对 `page.setCookie()` 作用范围的误解。`page.setCookie()` 内部走 Browser-level CDP session，写入浏览器级别真实 cookie store；而 `Network.setCookie`（page-level CDP session）写的是虚拟 NetworkContext，Chrome 发请求时不读这里。

**为什么之前没暴露**：Lighthouse 开内部 tab 时如果 Chrome 进程本身已有登录 Cookie（用户环境），会"碰巧"正常工作，掩盖了注入无效的问题。

**修复**：与 RecordingEngine 方案相同——用 tempPage 先导航到目标域建立 origin context，再用 `tempPage.setCookie()` 写入真实 Cookie jar，然后关闭 tempPage。

---

## BUG-10｜RecordingEngine 请求数据跨调用累积

**现象**：simulate 阶段录制的请求数是 analyze 阶段的两倍（`input=308 requests` vs `input=155`），串行链分析结果包含上次录制的脏数据。

**原因**：`#requests` 是实例变量，`RecordingEngine` 是全局单例，`record()` 每次调用只 push 不清空，导致数据跨 analyze/simulate 两次调用累积。

**修复**：在 `record()` 入口处重置 `this.#requests = []`。

---

## BUG-12｜动态接口检测粒度太粗，大量可缓存请求被误排除

**现象**：规则识别出 28 条串行链，但 `buildScript` 生成的 ENTRIES 只有 5 条，绝大多数请求没有被缓存，注入脚本几乎是空操作。

**原因**：动态接口检测以 `METHOD:URL` 为粒度——同一 URL 出现过多次不同 requestBody（如 `POST /getSubTree` 被调 13 次，每次传不同 dimension 参数），整个 URL 就被排除。但实际上每个 `(URL, method, body)` 三元组对应的响应是确定的，完全可以安全缓存，只是同一 URL 有多个不同的合法变体而已。

**修复**：改为以 `cacheKey`（METHOD:URL:md5(body)）为粒度建索引。只有当同一三元组在录制中出现多次且响应体不同时（服务器对相同输入返回了不同输出），才认定为动态，跳过缓存。

```js
// 修复前：URL 粒度，一刀切
const bodyIndex = {}  // "METHOD:url" → Set of requestBodies
if (bodies.size > 1) skip  // 只要出现多个不同 body 就全排除

// 修复后：cacheKey 粒度，精确识别
const cacheKeyIndex = {}  // cacheKey → Set of responseBodies
if (responsesForKey.size > 1) skip  // 只有同一输入返回不同输出才排除
```

---

## BUG-13｜注入脚本 XHR body 序列化错误导致全部 MISS

**现象**：ENTRIES 里存有 `POST /getConfig` 的缓存（requestBody = `action=getCompany`），但 simulate 阶段该请求始终 MISS，LCP 无改善。

**原因**：注入脚本 XHR 拦截的 body 处理：`var b = typeof body === 'string' ? body : ''`——页面代码用 `new URLSearchParams({action:'getCompany'})` 发请求，body 是 URLSearchParams 对象，`typeof` 判断不是 string，直接变成空字符串 `''`，和 ENTRIES 里的 `action=getCompany` 永远不匹配。fetch 拦截有相同问题（非字符串 body 用 `JSON.stringify` 处理，把 URLSearchParams 序列化成 `"{}"`）。

**修复**：新增 `serializeBody()` 函数，统一处理各种 body 类型：

```js
function serializeBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) { /* 转 key=value&... */ }
  try { return JSON.stringify(body); } catch(e) { return String(body); }
}
```

fetch 和 XHR 拦截均改用此函数，确保序列化方式与 CDP 录制时一致。

---

## BUG-14｜XHR HIT 无日志，误以为注入失败

**现象**：fetch HIT 时有 `[perfsim] HIT` 日志，但 XHR HIT 完全静默，无法判断注入脚本是否生效。

**原因**：XHR 的 HIT 日志被包在 `url.includes('concurrent') || url.includes('schedule') || url.includes('userInfo')` 条件里——这是开发阶段的临时 debug 代码，只对特定 URL 打印，其余 URL 命中时一律静默。

**修复**：删除临时条件，XHR HIT 统一在命中时打印日志，与 fetch 拦截行为对齐。

---

## BUG-15｜LighthouseRunner Cookie 注入无效，before/after 测的不是同一页面（指标全部上涨）

**现象**：推演完成后 after 指标全部高于 before，savedMs=0，表现为"优化后反而更慢"。

**原因**：`LighthouseRunner.#runOnce()` 使用 page-level CDP session 的 `Network.setCookie` 注入 Cookie，与 BUG-06/11 完全相同的破损路径。写入的是 Chrome 内部虚拟 NetworkContext，Lighthouse 内部新开的 tab 看不到这些 Cookie，每次都跳转登录页。

结果：
- `before` 阶段（LighthouseRunner）：Cookie 注入失败 → 测登录页 → LCP 极低（登录页轻量）
- `after` 阶段（SimulationEngine，已修复）：Cookie 正确注入 → 测真实应用 → LCP 正常偏高
- `after.lcp > before.lcp` → 所有指标"上涨"，与优化无关

**修复**：与 RecordingEngine / SimulationEngine 方案对齐——先 `goto(origin)` 建立 origin context，再用 `tempPage.setCookie()` 写入真实 cookie jar。

```js
// 修复前（破损）
const page = await browser.newPage()
const client = await page.createCDPSession()
await client.send('Network.setCookie', { ... })  // 写虚拟 store，无效
await page.close()

// 修复后
const tempPage = await browser.newPage()
await tempPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
await tempPage.setCookie(...puppeteerCookies)  // 写真实 cookie jar，所有 tab 共享
await tempPage.close()
```

**涉及文件**：`src/lighthouse-runner.js`

---

## BUG-16｜loadingFailed 请求无 endTime，导致串行链中途断裂（显示"未发现串行链"）

**现象**：串行链检测一直显示"未发现串行链"，即使页面有明显的串行 API 调用。

**原因**：`endTime` 仅在 `Network.responseReceived` 事件里赋值。CORS 失败、Cancel、超时等请求触发的是 `Network.loadingFailed`，不触发 `responseReceived`，这些请求被 push 进 `#requests` 但 `endTime === undefined`。

在 `chain-analyzer.js` 的串行判断里：
```js
next.startTime <= current.endTime + SERIAL_GAP_MS
// 当 current.endTime === undefined：
// undefined + 150 = NaN，next.startTime <= NaN → 永远 false
```
链条从第一个无 `endTime` 的请求起静默断裂，后续所有请求无法续接，整条链消失。

**修复**：在进入分析前过滤掉 `startTime` 或 `endTime` 缺失的请求。

```js
// 修复前
const networkRequests = requests.filter(r =>
  r.url && !r.url.startsWith('data:') && !r.url.startsWith('blob:')
)

// 修复后
const networkRequests = requests.filter(r =>
  r.url && !r.url.startsWith('data:') && !r.url.startsWith('blob:') &&
  r.startTime != null && r.endTime != null
)
```

**涉及文件**：`src/chain-analyzer.js`

---

## BUG-17｜test-rule-serial-chain.mjs L2/L3/L4 全部是"死"的单测

**现象**：运行测试，L2 报 `script too short (18 chars)`，L3/L4 级联失败。测试从来没有真正验证过 `buildScript` 的正确性。

**原因**：三处 fixture 问题叠加：

1. **`analyze()` 入参错误**：`rule.analyze({ chains: FIXTURE_CHAINS })` —— `analyze()` 完全忽略 `chains=` 参数，只读 `recording.requests`，传 `chains` 等于没传，`allRequests=[]` → 链为空。

2. **`responseHeaders` 缺失**：`isApiRequest()` 过滤器依赖 `responseHeaders['content-type']`，fixture 没有这个字段 → 所有请求被过滤 → `apiRequests=[]` → chains=0。

3. **`cacheKey` 缺失**：`buildScript()` 用 `cacheKey` 在 recorded 请求里查找 responseBody，fixture 没有 `cacheKey` → 匹配失败 → 生成空脚本（18 chars）。

**修复**：
- fixture 每条请求补全 `responseHeaders: { 'content-type': 'application/json' }` 和 `cacheKey: buildCacheKey(...)`
- 入参改为 `rule.analyze({ recording: FIXTURE_RECORDING, chains: FIXTURE_CHAINS })`
- import `buildCacheKey` 用于生成正确的 cacheKey

修复后：15/15 全部通过。

**涉及文件**：`test-rule-serial-chain.mjs`

---

## BUG-18｜重复请求去重规则 LCP 从 863ms 骤升至 5200ms（SEED 方案引发）

**现象**：rule-dedup-requests 上线后第一次模拟，LCP 从 863ms 跳到 5200ms，比 before 慢 4 倍多。

**根本原因**：初版实现用 SEED 方案（注入脚本直接把录制阶段的 responseBody 预填进 CACHE，所有重复请求不走网络直接返回录制时的旧数据）。

模拟阶段 Lighthouse 开一个全新的 Chrome 浏览器实例，新 session 的 sessionToken/CSRF token/业务 ID 与录制时完全不同。页面用旧数据里的旧 token 继续请求，服务端鉴权失败，级联报错，渲染阻塞，LCP 暴涨。

**关键认知**：录制和模拟不是同一个浏览器实例，也可能不是同一天。SEED 数据是快照，模拟阶段的 session 环境已经完全不同，把快照直接喂给新 session 是错误的。

**修复**：改为 WHITELIST 运行时缓存方案——
- 注入脚本只存一份 `{url, method, requestBody}` 的白名单（哪些接口是重复的）
- 第一次请求**始终真实走网络**（保证拿到当前 session 的新鲜数据）
- 第一次响应拿回来后缓存到内存
- 之后的重复请求才从缓存返回

第一次真实走网络是关键：WHITELIST 和 SEED 的本质区别在于"缓存谁的响应"——前者缓存**模拟阶段自己这次请求**的真实响应，后者缓存**录制阶段历史快照**，两者数据新鲜度完全不同。

```js
// SEED（错误）：注入脚本预填旧数据
var CACHE = { 'GET:xxx': { body: '...录制时的旧 JSON...', status: 200 } }

// WHITELIST（正确）：只记哪些接口是重复的，缓存由运行时自己填
var WHITELIST = [{ url: '...', method: 'GET', requestBody: '' }]
var CACHE = {}  // 空，由第一次真实响应填充
```

**涉及文件**：`server/rules/rule-dedup-requests.js`

---

## BUG-19｜并行重复请求被错误纳入去重 findings，导致 savedMs 虚高

**现象**：同一 URL 发出两个请求，但两个请求几乎同时发出（间隔 < 5ms），仍然被 rule-dedup-requests 标记为"可优化的重复请求"，savedMs 计入理论节省。

**原因**：初版去重逻辑只看 `group.length >= 2`，没有区分串行重复（B 等 A 返回后才发出）和并行重复（A、B 几乎同时发出）。

**为什么并行重复不是性能问题**：并行重复意味着 A、B 同时在飞（concurrent requests）。如果把 B 删掉，A 还是要跑同样的时间，LCP 不会缩短。WHITELIST 缓存也没用——A 还没返回的时候，B 已经在飞了，CACHE 是空的，B 拿不到缓存，只能走网络。并行重复只是浪费服务器资源，不影响前端性能，不应该进 findings。

**修复**：新增 `hasSerialDuplicate()` 过滤器——只有当后续调用的 startTime ≥ 第一次调用的 endTime - 20ms 时，才认为是串行重复。20ms 是 CDP 时间戳采样误差容差（loadingFailed、网络抖动导致 endTime 和实际结束时间有微小偏差）。

```js
const SERIAL_TOLERANCE_MS = 20

function hasSerialDuplicate(group) {
  const first = group[0]
  if (first.endTime == null) return false
  return group.slice(1).some(r => r.startTime >= first.endTime - SERIAL_TOLERANCE_MS)
}

// 只保留串行重复，并行重复在 summary 里提示但不进 findings
const duplicates = allDuplicates.filter(hasSerialDuplicate)
const parallelOnly = allDuplicates.length - duplicates.length
```

并行重复数量在 summary 中透明告知用户（"另有 X 个并行重复，不可去重"）。

**涉及文件**：`server/rules/rule-dedup-requests.js`

---

## BUG-20｜规则结果 findings 字段缺失，pipeline 无法感知优化项（无法触发 Lighthouse）

**现象**：日志显示 `rule-dedup-requests findings=2`（找到 2 个重复请求），但 simulate 阶段判定 `hasOptimizableRules=false`，直接跳过 Lighthouse，返回 savedMs=0。

**原因**：`rule-engine.js` 读 `analysisResult.findings`；`app.js` 判断 `r.findings.length > 0`；但 `rule-dedup-requests` 的 `analyze()` 返回的是 `duplicates` 字段，没有 `findings` 字段。另外历史遗留的 `rule-serial-chain.js` 返回 `chains` 字段，也没有 `findings`。pipeline 读到的 `findings` 全是 `undefined`，所有规则都被认为没发现问题。

**修复**：统一规则契约，所有规则必须返回 `findings` 字段（语义上叫什么都行，但必须同时挂到 `findings` 上）：

```js
// rule-dedup-requests
return {
  duplicates,      // 语义别名
  findings: duplicates,  // 契约必填字段
  ...
}

// rule-serial-chain  
return {
  findings: qualified,  // 原来是 chains: qualified
  ...
}
```

同时将 `rule-engine.js` 的 `chains` 引用、`app.js` 的 `sanitizeRules`、`hasOptimizableRules` 判断全部改为 `findings`，完成全链路重构。

**涉及文件**：`server/rules/rule-dedup-requests.js`、`server/rules/rule-serial-chain.js`、`server/src/rule-engine.js`、`server/src/app.js`

---

## BUG-21｜ReportTab 结论硬编码串行链逻辑，新规则无法正确展示

**现象**：添加了 rule-dedup-requests 后，报告结论页仍然显示"串行链并行化"相关措辞，规则名和 summary 与实际运行规则无关。

**原因**：`Conclusion` 组件完全硬编码了"串行链"的文案，读取 `sim.chains` 而不是 `sim.rules`，不知道当前选了哪些规则、每条规则发现了什么。

**修复**：重构 `Conclusion` 组件为规则感知设计——
- 从 `sim.rules[]` 读取每条规则的 `ruleName`、`severity`、`summary`
- severity=high 的规则组合触发高价值结论，medium 触发中等结论
- 每条规则的 summary 单独列出，带彩色状态点
- 不再有任何硬编码的"串行链"文案

同时将 findings 列表从 `ChainCard`（串行链专用）替换为通用 `FindingCard`（消费规则自己的 `buildCard()` 输出），每个规则完全自主声明卡片数据格式。

**涉及文件**：`extension/src/pages/ReportTab.tsx`

---

## 附：dist 不存在问题澄清

**结论**：server 端无 dist，无需担心引用旧文件。

- **server**：纯 ESM，`node src/index.js` 直接运行 `src/` 下的源文件，改完即生效，重启 server 即可。
- **extension**：Vite 构建，Chrome 加载的是 `dist/`。若改了 `extension/src/`，需 `npm run build` 后在 Chrome 扩展管理页重新加载。
