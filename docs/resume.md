# PerfSim Platform — Resume 项目描述

## 一句话描述

开发了一款 Chrome Extension + 本地 Node.js Server 的前端性能推演工具，通过「录制-回放」机制在**不修改任何生产代码**的前提下，量化前端优化策略（串行请求链消除、资源预加载）能带来的 LCP/FCP 提升上限。

---

## 技术栈

| 层 | 技术 |
|----|------|
| Extension UI | React 18 + Vite + TailwindCSS + Zustand |
| Extension 逻辑 | Chrome MV3 / Background SW / Content Script / IndexedDB |
| Server | Node.js + Express 5 + SSE |
| 浏览器自动化 | Puppeteer + CDP（Chrome DevTools Protocol） |
| 性能测量 | Lighthouse 12（CDP port bridge，provided 模式） |
| 测试 | Vitest + supertest（13 文件 77 测试） |

---

## 核心功能与实现

### 1. 两阶段录制+回放推演引擎

- **录制阶段**：Puppeteer headless 打开目标页面，通过 CDP `Network.responseReceived` 拦截所有请求响应，识别时序上的串行请求链（A 结束后 150ms 内 B 发起）
- **推演阶段**：将优化脚本通过 `evaluateOnNewDocument` 注入页面，拦截 fetch/XHR 对串行链请求直接返回缓存响应（延迟趋近 0），再运行 Lighthouse × 3 取中位数得到模拟优化后指标

### 2. 可插拔规则系统

- 定义规则契约：`analyze()` / `calculateTheoretical()` / `buildScript()` / `buildCard()`
- 内置两条规则：串行请求链并行化（rule-serial-chain）、重复请求去重（rule-dedup-requests）
- 支持用户通过 Extension UI 上传自定义 `.js` 规则，Server 动态 `import()` 验证契约后热加载
- `buildCard()` 让每条规则自主声明卡片渲染数据（title / badge / rows），前端 `FindingCard` 通用消费，无需为每种规则写专用组件

### 3. Chrome Extension MV3 架构

- Background SW + ContentScript Port 保活（解决 MV3 SW 30 秒休眠问题）
- SSE 实时进度推送（4 阶段：录制→分析→基线测量→注入测量）
- IndexedDB HistoryStore 持久化最近 10 条推演记录
- ReportTab 独立报告页，支持结论摘要层（规则感知，产品视角）+ 技术细节层 + HTML 导出

---

## 解决的核心难题

### 1. Cookie 透传与 CDP 层级陷阱

Chrome Extension 读取当前页面 Cookie，通过 HTTP 传给本地 Server，Server 用 Puppeteer 注入到 headless Chrome，让录制和推演都能访问需要登录态的页面。

**陷阱**：`Network.setCookie`（page-level CDP session）写入的是 Puppeteer 内部虚拟 NetworkContext，浏览器真实发请求时不读这个 store，导致请求头里 Cookie 始终为空。调试过程中 `Network.getAllCookies` 显示注入成功，但实际请求携带的 Cookie 是 `(none)`——两个 API 读写的根本不是同一个 store。

**解决**：先导航到目标域建立 origin context，再用 `page.setCookie()` 写入浏览器级别真实 Cookie jar。这一 bug 在 RecordingEngine、LighthouseRunner、SimulationEngine 三处各自独立出现，每处修复逻辑相同但要单独定位。

### 2. 所有指标"优化后反而更慢"的根因溯源

**现象**：推演结果 after LCP > before LCP，savedMs 显示为负值，看起来优化脚本让页面变慢了。

**溯源过程**：before 由 LighthouseRunner 测量，after 由 SimulationEngine 测量。当时 SimulationEngine 已修复 Cookie 注入（测真实页面），但 LighthouseRunner 仍用破损的 `Network.setCookie`（测登录页）。登录页极其轻量，LCP 只有几百毫秒；真实应用 LCP 上千毫秒。两端测的根本不是同一个页面，before/after 不可比较，导致所有指标"上涨"。

**关键**：单独 debug 每个模块都看起来正常，只有在端到端场景下才会暴露"两端 Cookie 注入状态不一致"的问题。

### 3. 注入脚本的 SEED vs WHITELIST 设计取舍

重复请求去重规则的注入脚本有两种方案：

- **SEED**：把录制时的 responseBody 直接预填进运行时 CACHE，模拟阶段直接返回旧数据
- **WHITELIST**：只记录哪些接口是重复的，第一次始终真实走网络，响应回来后才填 CACHE，后续重复请求从 CACHE 返回

SEED 方案初看合理，实现后 LCP 从 863ms 暴涨到 5200ms。根因：录制和模拟用的是不同的 Chrome 实例，session token / CSRF token 完全不同，旧数据里的旧 token 喂给新 session，服务端鉴权失败，级联报错阻塞渲染。

WHITELIST 方案的本质是"缓存模拟阶段自己的第一次真实响应"，不依赖录制快照，规避了数据新鲜度问题。

### 4. 串行 vs 并行重复的精确识别

两个相同请求同时发出（并行重复）和依次发出（串行重复）从数据上都表现为 `group.length >= 2`，但性质完全不同：并行重复删掉一个不影响 LCP（另一个还在飞），不是前端性能优化目标；串行重复消除才能真正节省时间。

用 `B.startTime >= A.endTime - 20ms` 区分两者（20ms 是 CDP 时间戳采样误差容差），只有串行重复才进 findings 计入理论节省。并行重复在 summary 里透明告知但不影响推演结果。

### 5. 动态接口识别的粒度问题

注入脚本需要把录制响应缓存起来按请求匹配返回。问题是部分接口是动态的——相同输入，服务端每次返回不同内容（含时间戳、随机 token）。

初版用 URL 粒度检测：同一 URL 出现了多次不同 requestBody，整个 URL 排除。导致 `POST /getSubTree` 被调 13 次（每次传不同 dimension 参数）时，整个 URL 一刀切全排除，实际上每个 `(URL, method, body)` 三元组对应的响应是确定的，完全可以安全缓存。

改为 cacheKey 粒度（METHOD:URL:md5(body)）：只有同一三元组在录制中出现多次且响应体不同（服务端对完全相同的输入返回了不同输出）才真正排除。精确度大幅提升，ENTRIES 命中率从 5/28 提升到 14+/28。

### 6. loginRedirect 误判的边界处理

基于关键词（`url.includes('login')`）的跳转检测会误判应用路由本身含 `login` 的页面（如 `/hdb/login/home#/designModelSheet2/...`）。

改为对比目标路径前缀和最终路径的差异，且仅当目标路径本身不含 login 关键词时才判定为真正的跳转，避免正常页面被误判为 Cookie 失效。

---

## 项目指标

- 测试覆盖：13 个测试文件，77 个测试用例，覆盖核心算法、API 路由、规则引擎
- 推演耗时：约 3-5 分钟（Lighthouse × 6 次：baseline 3 次 + simulation 3 次）
- 支持页面类型：任意 HTTP/HTTPS 页面，含需登录的鉴权页面
- 内置规则：2 条（串行链并行化、重复请求去重），支持用户上传自定义规则热加载
