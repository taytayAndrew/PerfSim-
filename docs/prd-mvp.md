# PRD: PerfSim Platform MVP

## Problem Statement

前端开发者和产品经理面临一个共同难题：当页面性能不达标时，无法快速判断「前端优化的上限在哪里」。开发者需要花大量时间手动分析 Lighthouse 报告、猜测优化收益，产品经理无法区分性能问题是前端还是后端造成的，导致优化方向错误、沟通成本高。

核心痛点：

- 没有工具可以在**不修改生产代码**的情况下，量化某个优化策略（如消除串行请求链）能带来多少性能提升
- 产品经理无法用数据回答「这个慢是前端的问题还是后端的问题」
- 前端优化决策依赖经验直觉，缺乏可量化的「优化潜力上限」数据支撑

## Solution

PerfSim Platform 是一个「前端性能推演工具」，由 Chrome Extension + 本地 Node.js Server 组成。

核心机制是**两阶段录制+重放**：

1. **录制阶段**：Server 用 Puppeteer（headless）打开目标页面，CDP 拦截所有网络请求响应，识别串行请求链，同时跑 Lighthouse 获得基线指标
2. **推演阶段**：将优化规则的注入脚本通过 `evaluateOnNewDocument` 注入 Puppeteer，让串行链请求直接走缓存（延迟趋近 0），再跑 Lighthouse x3 取中位数，得到模拟优化后的真实指标

用户看到的是：
- **结论摘要层**（给产品）：「LCP 可从 4.2s → 2.8s，前端串行链优化空间 1.4s」
- **技术细节层**（给工程师）：串行链列表、置信度、接口路径、理论收益计算过程

所有优化策略以**可插拔规则**的形式存在，官方内置规则 + 用户自定义规则均支持。

## User Stories

### 前端工程师

1. 作为前端工程师，我想分析当前浏览器 Tab 的页面性能，以便发现串行请求链等优化机会
2. 作为前端工程师，我想在不修改任何代码的情况下，看到「消除串行链后 LCP 能提升多少」，以便决定是否值得投入优化
3. 作为前端工程师，我想在推演前选择要应用的优化规则，以便针对性地评估某个优化策略的收益
4. 作为前端工程师，我想看到所有检测到的串行请求链列表（含确认串行和疑似串行），以便判断哪些链是真正需要优化的
5. 作为前端工程师，我想看到每条串行链的接口路径、深度、总延迟，以便快速定位问题接口
6. 作为前端工程师，我想看到推演的置信度标注，以便理解结果的可信程度
7. 作为前端工程师，我想在推演期间看到实时进度，以便了解当前跑到哪个阶段
8. 作为前端工程师，我想在推演完成后看到 before/after 指标对比（LCP / FCP / TTI），以便量化优化效果
9. 作为前端工程师，我想把报告导出为 HTML 文件，以便分享给团队或存档
10. 作为前端工程师，我想看到历史分析记录（按 URL 分组），以便回顾之前的分析结果
11. 作为前端工程师，我想导入自己写的规则脚本，以便测试自定义的优化策略
12. 作为前端工程师，我想在推演失败时看到明确的错误原因和重试按钮，以便快速排查问题
13. 作为前端工程师，我想对需要登录的页面进行分析，Extension 自动透传当前页面的 Cookie，以便不需要手动配置登录态
14. 作为前端工程师，我想看到「未发现串行请求链问题」的明确提示，以便知道该规则对当前页面没有优化空间

### 产品经理

15. 作为产品经理，我想在报告顶部看到一句话结论（前端最多能优化多少毫秒），以便在不理解技术细节的情况下做出决策
16. 作为产品经理，我想将报告 HTML 文件直接分享给技术负责人，以便进行优化优先级讨论
17. 作为产品经理，我想知道当前性能问题中「前端能解决的」和「需要后端优化的」各占多少，以便准确定位问题责任方

### 规则作者

18. 作为规则作者，我想按照标准契约（analyze / calculateTheoretical / buildScript）编写规则，以便规则能被 PerfSim 正确加载和执行
19. 作为规则作者，我想在规则的 analyze() 中自定义识别阈值，以便针对不同项目的特点调整检测敏感度
20. 作为规则作者，我想在规则定义中设置置信度，以便告知用户理论预测的可信程度
21. 作为规则作者，我想通过 Extension UI 上传 .js 规则文件，以便立即在规则列表中使用自定义规则

## Implementation Decisions

### 架构

- **2 层架构**：Chrome Extension（MV3）+ 本地 Node.js Server（localhost:3000）
- **通信协议**：HTTP（触发指令）+ SSE（实时进度推送）
- Extension 只负责 UI 和触发指令，所有计算均在 Server 端执行

### Server 端模块

**RecordingEngine**
- 使用 Puppeteer（headless）打开目标页面
- 通过 CDP（`Network.enable` + `Network.responseReceived`）拦截所有请求响应
- 记录每个请求的 URL、method、requestBody、responseBody、startTime、endTime
- 透传 Extension 传来的 Cookie（`page.setCookie()`）
- 自动调用 `page.setBypassCSP(true)` 绕过 CSP 限制
- 响应体 > 500KB 的接口不缓存，走真实网络并在报告中标记

**ChainAnalyzer**
- 输入：录制数据（请求时序列表）
- 输出：串行链列表，每条链包含 `{ depth, totalDelayMs, urls, confirmed }`
- 识别逻辑：检测 B 的请求参数是否包含 A 的响应数据（确认串行）；时序上顺序发出但无数据依赖的标记为「疑似串行」
- HTTP/2 假串行处理：保守策略，宁可误判为真串行
- 缓存 key = URL + method + hash(requestBody)
- 不禁用 Service Worker；录制阶段标记响应来源（SW cache / 网络），注入脚本只拦截来自网络的串行链请求

**RuleRegistry**
- 启动时扫描 `rules/` 目录，加载所有 .js 规则文件
- 验证每条规则是否实现完整契约（analyze / calculateTheoretical / buildScript）
- 提供 `GET /api/rules` 接口返回规则列表（含名称、描述、置信度）
- 提供 `POST /api/rules/import` 接口接收上传的自定义规则，验证后保存

**RuleEngine**
- 一次录制，多规则共用同一份数据
- 并行执行所有选中规则的 `analyze(recordingData)`
- analyze() 标准返回结构（来自原型阶段的决策）：
  ```
  {
    severity: 'critical' | 'warning' | 'info',
    affectsLCP: boolean,
    chains: [{ depth, totalDelayMs, urls, confirmed }],
    summary: string
  }
  ```

**LighthouseRunner**
- 通过 CDP port 与 Puppeteer 共享同一 Chrome 实例
- baseline 和 simulation 各跑 3 次，取中位数（共 6 次）
- 提取 LCP、FCP、TTI 指标
- 理论收益计算：串行链并行化后节省的时间 = 第2...N个请求的 startTime 延迟之和
- LCP 关联判断：串行链结束时间 ≤ LCP renderTime → 时序关联，给出预测收益（置信度：中）

**ScriptInjector**
- 调用规则的 `buildScript(analysisResult, cacheData)` 获得脚本字符串
- 通过 `page.evaluateOnNewDocument(scriptString)` 注入
- 脚本参数内联进闭包（不使用全局变量），避免被页面覆盖
- 网络拦截类规则禁止修改 DOM；预加载类规则允许插入 `<link rel="preload">`

**SessionManager**
- 每次分析生成唯一 sessionId
- 录制数据落磁盘临时文件（不只存内存）
- 推演完成或失败后自动清理临时文件
- 用户重新分析时旧 session 文件自动清理
- 单任务模型：同时只允许一个推演任务，重复触发返回「推演进行中」提示

**SSEServer**
- `GET /api/simulate/progress` 建立 SSE 连接
- 推送事件类型：`progress`（阶段进度）、`result`（最终结果）、`error`（失败原因）
- SSE 连接断开时触发 Puppeteer 实例清理

### Extension 端模块

**ContentScript**（注入目标页面）
- 建立 `chrome.runtime.connect()` Port 连接，保持 Background SW 存活（防止 MV3 30秒休眠）
- 建立 SSE 连接（`EventSource`），接收 Server 实时进度
- 通过 Port 将进度数据转发给 Background SW
- 推演开始时注入半透明全屏遮罩 + 「推演中，请勿操作」文案 + 进度条
- 推演结束或失败时移除遮罩
- 监听页面 URL 变化，跳转到登录页时立即中断并提示「Cookie 可能已失效」

**BackgroundSW**
- 接收 ContentScript 转发的进度消息
- 推演完成时将结果存入 IndexedDB（通过 HistoryStore）
- 打开新 Report Tab 展示结果
- 推演失败时通知 Popup 展示错误

**HistoryStore**
- 基于 IndexedDB 的读写模块
- 按 URL 分组，每个 URL 保留最近 1 条分析记录
- 提供 `save(url, result)`、`getByUrl(url)`、`getAll()` 接口

**Popup**
- 读取当前 Tab 的 URL + Cookie，作为分析参数
- `GET /api/rules` 拉取规则列表展示（Server 离线时展示「请先启动本地 Server」）
- 规则选择列表，底部加「更多规则即将推出」
- 分析摘要展示（串行链数量、理论收益）
- 推演期间同步展示进度条
- 失败时展示人话错误原因 + 重试按钮
- 支持自定义规则上传（文件选择器 → POST /api/rules/import）

**ReportTab**
- 顶部结论摘要层：单句话结论 + 核心指标 before/after
- 技术细节层（折叠）：串行链列表（确认/疑似分组）、接口路径、深度、延迟、置信度
- 支持导出为 HTML（内联样式，双击可直接打开）
- 数据来源：从 IndexedDB 读取（通过 HistoryStore）

### 内置规则

**rule-serial-chain**（串行请求链并行化）
- analyze()：识别串行请求链，深度/耗时阈值由规则自身决定
- calculateTheoretical()：计算串行链并行化后的 LCP/FCP/TTI 理论收益
- buildScript()：生成 fetch/XHR 拦截脚本，命中串行链 URL 直接返回缓存响应

**rule-resource-preload**（关键资源预加载）
- analyze()：识别首屏关键资源（JS/CSS/图片）发现时机偏晚的情况
- calculateTheoretical()：估算提前加载能节省的等待时间，换算为 FCP/LCP 收益
- buildScript()：生成插入 `<link rel="preload">` 标签的脚本

### API 契约

```
GET  /health                    健康检查
GET  /api/rules                 获取规则列表
POST /api/rules/import          上传自定义规则
POST /api/analyze               触发录制+分析（含 baseline Lighthouse）
POST /api/simulate              触发推演（注入脚本+跑 Lighthouse x3）
GET  /api/simulate/progress     SSE 实时进度流
```

POST /api/analyze 请求体：
```json
{
  "url": "https://example.com",
  "cookies": [...],
  "ruleIds": ["rule-serial-chain", "rule-resource-preload"]
}
```

## Testing Decisions

**好的测试标准**：通过公共接口测试外部行为，不测试实现细节。测试应该在内部重构后仍然通过。

**优先测试的模块**：

- **ChainAnalyzer**：核心算法，输入录制数据 → 输出串行链列表。纯函数逻辑，无外部依赖，最适合单元测试。测试用例覆盖：确认串行识别、疑似串行标记、假串行过滤、多条链同时存在
- **RuleEngine**：规则加载和 analyze() 调用逻辑。使用 mock 规则脚本验证并行执行、结果聚合、契约验证失败处理
- **LighthouseRunner**（中位数计算部分）：从3次结果取中位数的逻辑，纯函数，独立测试
- **RuleRegistry**：规则扫描、契约验证、注册逻辑。使用 fixture 规则文件测试合法规则加载和非法规则拒绝
- **HistoryStore**：IndexedDB 读写逻辑。使用 fake-indexeddb 库测试 save/getByUrl/getAll 行为，以及「每URL保留最近1条」的淘汰逻辑
- **SessionManager**：临时文件创建、清理、单任务锁逻辑

**不测试的模块**（mock 成本过高）：RecordingEngine（依赖真实 Puppeteer）、ScriptInjector（依赖 Puppeteer page API）、ContentScript（浏览器环境）、Popup/ReportTab（UI）

## Out of Scope

- TBT（Total Blocking Time）指标支持（后续迭代）
- 报告中的「规则覆盖范围边界」说明（等规则多了再加）
- CI/CD 集成（v2）
- 第三条及以后的内置规则（post-MVP）
- 多规则推演结果的独立对比（当前：同时应用所有选中规则）
- 部分接口排除（当前：整条链作为整体推演）
- Web Worker 内请求拦截（当前：仅主线程 fetch/XHR）
- 规则沙箱隔离（当前：信任声明替代）
- 端口自定义配置 UI（当前：默认 3000，README 说明）

## Further Notes

- 目标开发环境为 Windows，所有文件路径使用 `path.join`，进程终止使用 `taskkill`
- Puppeteer 运行在 headless 模式，用户不可见
- 推演结果是「优化潜力上限」（串行链接口延迟趋近 0 的理论值），非精确预测，报告中需明确传达
- 自定义规则运行在本地 Node.js 环境，文档注明「请只导入你信任的脚本」
- Lighthouse 方差问题通过 3 次取中位数缓解，推演前告知用户预计耗时（约 3-5 分钟）
