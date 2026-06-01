# PerfSim 面试问答

## 项目介绍类

**Q: 用一句话介绍这个项目？**

A: PerfSim 是一个前端性能推演工具，通过「录制页面真实网络请求 → 注入优化脚本拦截串行链 → 跑 Lighthouse 测量」的方式，在不改任何生产代码的前提下，量化「如果把串行请求链改成并行，LCP 能提升多少」。

---

**Q: 为什么做这个工具？解决了什么问题？**

A: 前端优化决策依赖经验，缺乏数据支撑。产品经理无法判断「这个慢是前端问题还是后端问题」，工程师做优化前无法评估收益是否值得投入。PerfSim 给出的是「优化潜力上限」——如果串行链消除，理论上能快多少——让优化决策有数可依。

---

## 技术深度类

**Q: 你说「不修改生产代码」，那注入脚本是怎么工作的？**

A: 通过 Puppeteer 的 `evaluateOnNewDocument` API，在页面每次导航前把脚本注入到 JavaScript 执行环境。脚本替换了 `window.fetch` 和 `XMLHttpRequest.prototype.send`，当页面代码发出串行链里的请求时，直接从内存缓存里返回录制阶段抓到的响应体，响应时间趋近 0ms，模拟了这些请求被并行化的效果。整个过程对页面代码完全透明。

---

**Q: 为什么用 Lighthouse 的 provided 模式？**

A: Lighthouse 默认用 Lantern 模拟器——它从底层网络 trace（TCP 握手、bytes 传输）重新建模性能指标，完全忽略 JS 层面的 fetch/XHR 拦截。也就是说，即使我们的注入脚本把响应时间压到 0ms，Lantern 看到的还是原始网络延迟，LCP 不会变。`throttlingMethod: 'provided'` 让 Lighthouse 直接信任实际观测到的时序，注入效果才能被真实测量到。

---

**Q: Cookie 透传是怎么做的？遇到了什么坑？**

A: Extension 通过 `chrome.cookies.getAll()` 读取当前页面的 Cookie，随分析请求传给 Server，Server 再注入到 Puppeteer。

坑在于注入时机。我最开始用 CDP 的 `Network.setCookie` 命令注入，日志显示成功，`Network.getAllCookies` 也能读到，但实际请求头里 Cookie 是空的。排查后发现 page-level CDP session 的 `setCookie` 写入的是 Puppeteer 内部的虚拟 NetworkContext，不是浏览器真实的 Cookie jar，两个 store 完全隔离。

正确做法是先让 page 导航到目标域建立 origin context，再用 `page.setCookie()` 写入。这个 API 才真正操作浏览器的 Cookie jar，后续请求才会携带。

---

**Q: 串行链是怎么识别的？**

A: 录制阶段用 CDP 记录每个请求的 `startTime` 和 `endTime`。对请求按 startTime 排序后，检测相邻请求是否满足：B 的 startTime ≥ A 的 endTime，且 B 的 startTime ≤ A 的 endTime + 150ms。这个 150ms 的窗口覆盖了 JSON.parse、Promise microtask、业务逻辑处理的典型耗时，大于 150ms 通常是用户交互或定时器，不属于因果串行依赖。

只对 JSON API 请求做识别，静态资源（JS/CSS/图片）的串行加载是浏览器正常的解析顺序，不算优化目标。

---

**Q: 动态接口是怎么处理的？**

A: 注入脚本需要把录制的响应缓存起来，按 URL+method+requestBody 匹配。问题是有些接口的响应是不确定的——相同的输入，服务端每次返回不同内容（比如含时间戳、随机 token 的响应），缓存这类接口会让页面拿到脏数据。

关键是检测粒度。最初用 URL 粒度：同一 URL 出现了多次不同 requestBody，就整个 URL 排除。但这太保守——`POST /getSubTree` 可能被调 13 次，每次传不同的 dimension 参数（ACCOUNT/DAY/ENTITY...），每个 `(URL, method, body)` 三元组对应的响应是完全确定的，完全可以安全缓存，只是同一 URL 有多个合法变体。

正确粒度是 `cacheKey`（METHOD:URL:md5(body)）：只有当同一三元组在录制中多次出现且响应体不同时（服务端对完全相同的输入返回了不同的输出），才认定为真正的动态接口，跳过缓存。每个独特的三元组都是一个独立的确定性缓存条目。

无法缓存的接口在报告里通过 `dynamicUrls` 字段标注，告知用户这些接口无法被模拟优化，实际收益会低于报告值。

---

**Q: Chrome MV3 的 Background Service Worker 有什么限制？你是怎么处理的？**

A: MV3 的 Background SW 在 30 秒无活动后会被 Chrome 强制休眠，而推演需要 3-5 分钟。

解决方案：ContentScript 在目标页面建立 `chrome.runtime.connect()` Port 连接，Port 连接存在期间 SW 不会休眠。同时用 `chrome.alarms` 每 20 秒触发一次轻量操作（读 storage）作为备用保活。SW 的状态持久化到 `chrome.storage.local`，即使被意外杀掉重启后也能恢复到正确状态。

---

**Q: 推演结果不准怎么办？**

A: 工具定位是「优化潜力上限」而非精确预测，报告里也明确标注了置信度。影响结果准确性的因素：

1. **Lighthouse 方差**：通过跑 3 次取中位数缓解，但网络环境波动仍然存在
2. **动态接口**：无法拦截的接口不在模拟范围内，实际收益会低于报告值
3. **串行链识别误差**：150ms 窗口可能误判或漏判，报告中标注置信度（high/medium）
4. **提前返回缓存的副作用**：某些页面逻辑依赖 API 响应做状态初始化，直接返回缓存可能导致页面行为异常，LCP 测量偏差

---

## 设计决策类

**Q: 为什么选择本地 Server + Extension 的架构，而不是纯 Extension？**

A: Puppeteer 和 Lighthouse 必须在 Node.js 环境运行，没办法跑在浏览器里。Extension 只能做 UI 和触发指令，所有计算都在本地 Server。这个架构也带来好处：Server 可以独立测试，Extension 的职责单一，两端可以独立迭代。

---

**Q: 规则系统为什么设计成可插拔的？**

A: 不同页面的性能瓶颈不同，内置规则不可能覆盖所有场景。可插拔设计让规则作者可以针对自己项目的特点写检测逻辑，比如特定框架的数据加载模式、特定 CDN 的优化策略等。规则契约（analyze/calculateTheoretical/buildScript）把分析、理论计算、注入脚本三个关注点分离，每个函数职责清晰。

---

**Q: 你觉得这个项目最难的地方是什么？**

A: 最难的是「测量本身不能污染被测对象」这个约束，以及多个组件状态必须全部对齐才能端到端工作。

注入脚本拦截了 fetch/XHR，必须保证：
- 缓存命中时立即返回，不引入额外延迟
- 未命中时透传给原始 fetch/XHR，页面行为完全不变
- 动态接口必须跳过，否则页面拿到脏数据

更难的是，有几个 bug 只有在所有组件同时运行时才会暴露。最典型的例子是"所有指标优化后反而更慢"——before 由 LighthouseRunner 测，after 由 SimulationEngine 测。当时 SimulationEngine 已经修复了 Cookie 注入（测真实页面），但 LighthouseRunner 还用的是破损的 `Network.setCookie`（测登录页）。两端测的根本不是同一个页面，LCP 不可比较。单独看每个模块都正常，只有端到端跑完才能发现这个问题。

---

**Q: 重复请求去重规则遇到了什么坑？**

A: 遇到了两个完全不同方向的坑。

第一个是 SEED 方案引发的 LCP 暴涨。我最初的设计是把录制时的 responseBody 预填进注入脚本的 CACHE，模拟阶段命中直接返回。上线后 LCP 从 863ms 跳到 5200ms，比 before 慢 4 倍。

根因是录制和模拟用的是不同的 Chrome 实例，session token 完全不同。旧数据里的旧 token 喂给新 session，服务端鉴权失败，级联报错阻塞渲染。改成 WHITELIST 方案——只记录哪些接口是重复的，第一次始终真实走网络，拿到新鲜响应后才缓存，后续重复请求从缓存返回。

第二个是并行重复和串行重复的混淆。两个相同请求 `group.length >= 2` 有两种情况：串行（B 等 A 返回后才发）和并行（A、B 同时飞）。我一开始把两种都算进 findings。但并行重复删掉一个 B，A 还是要跑同样的时间，LCP 不缩短，WHITELIST 拦截也拦不住（A 还没返回时 CACHE 是空的，B 飞出去了）。加了 `hasSerialDuplicate()` 过滤，只有 `B.startTime >= A.endTime - 20ms` 才是真正可优化的串行重复，20ms 是 CDP 时间戳采样误差容差。

---

**Q: 规则系统的 `findings` 字段是怎么来的？为什么不让规则自定义字段名？**

A: 这个字段是在踩坑后加的契约约束，不是一开始设计好的。

最初 rule-serial-chain 返回 `chains` 字段，pipeline 读 `analysisResult.chains`。后来加了 rule-dedup-requests，它返回 `duplicates` 字段。pipeline 不知道该读哪个字段，两条规则的结果都读不到，`hasOptimizableRules` 永远是 false，Lighthouse 模拟一直被跳过。

统一成 `findings` 是解决这个问题最简单的方式——语义上你爱叫什么都行（`duplicates`、`chains`、`issues`），但必须同时把它挂到 `findings` 上（`findings: duplicates`）。pipeline 只认 `findings`，不关心其他字段。这个约束写进了规则契约文档，后续新写规则时也必须遵守。

---

## 浏览器工作原理类

**Q: 能讲一下浏览器从输入 URL 到页面渲染完成的完整过程吗？**

A: 以典型 SPA（React/Vue）为例，分六个阶段：

**① 网络层**
DNS 解析域名 → TCP 三次握手 → TLS 握手（HTTPS）→ 发送 HTTP 请求 → 服务器返回 HTML。这些都在网络层，浏览器还没开始渲染任何东西。

**② HTML 解析**
浏览器边接收 HTML 字节流边解析，遇到资源立刻发起加载。`<script>` 默认阻塞 HTML 解析，必须下载执行完才能继续。`<link rel="preload">` 放在 `<head>` 最前面的意义就在这里——让浏览器在解析 HTML 最开始就提前并行发起请求，不等到真正用到时才加载。

**③ JS 引擎初始化**
V8 创建全局执行上下文、创建 window 对象、注册所有 Web API（fetch、XMLHttpRequest、setTimeout...）。`evaluateOnNewDocument` 注入的脚本在这一步之后、任何页面 JS 执行之前运行——所以能成功替换 `window.fetch`，页面自己的代码拿到的已经是替换过的版本。

**④ 页面 JS 执行**
框架初始化 → 组件挂载 → 发出第一批 API 请求 → 拿到响应 → 发出第二批（串行依赖）。PerfSim 的注入脚本在这里拦截 fetch/XHR，对串行链请求直接返回缓存响应（0ms），页面逻辑照常走但时间大幅压缩。

**⑤ 渲染**
JS 操作 DOM → 浏览器计算 Layout → Paint → Composite → 屏幕上出现内容。
- **FCP**：屏幕上第一次出现任何内容的时刻
- **LCP**：最大内容元素（主图/主标题）渲染完成的时刻，衡量"用户觉得页面加载好了"最重要的指标

如果 API 串行链在 LCP 渲染路径上（页面要等 API 数据才能渲染主内容），消除串行链能直接缩短 LCP。

**⑥ 后续加载**
懒加载图片/路由组件、后台埋点日志等。**TBT（Total Blocking Time）**：主线程被长任务占用、无法响应用户交互的总时间，JS 执行时间长会导致 TBT 高。

---

**Q: 为什么 `<link rel="preload">` 必须写在 HTML 里，JS 动态插入没用？**

A: `<link rel="preload">` 的作用是告诉浏览器"我等一下要用这个资源，现在就开始加载"。它必须在浏览器**解析 HTML 阶段**就被看到，才能和其他资源并行加载，达到提前发现的效果。

JS 动态插入 `<link rel="preload">` 最早也要等到 JS 引擎初始化完、页面脚本开始执行之后——那时候浏览器早就在 HTML 解析阶段把各种资源的加载队列排好了，晚来的 preload 指令要么命中缓存没效果，要么重复发请求。

PerfSim 曾经有一条 `rule-resource-preload` 规则，在 `evaluateOnNewDocument` 里用 `document.head.appendChild(link)` 注入预加载标签。但 `evaluateOnNewDocument` 执行时 HTML 还没开始解析，`document.head` 是 `null` 直接报错；即使修了这个 bug 改成等 `DOMContentLoaded` 再插入，资源也早就加载完了，毫无意义。这条规则因此被删除。

---

**Q: PerfSim 的注入脚本为什么用 `evaluateOnNewDocument` 而不是其他方式？**

A: 有几个备选方案都行不通：

- **页面加载后注入**：fetch/XHR 已经发出去了，拦截没有意义
- **Service Worker**：需要域名配合注册，对目标页面有侵入性，且不是所有页面都支持
- **Chrome Extension Content Script**：执行时机比 `evaluateOnNewDocument` 晚，页面 JS 可能已经执行过第一批请求

`evaluateOnNewDocument` 是 Puppeteer 提供的 API，让脚本在 JS 引擎初始化完成、页面任何代码执行之前注入。这是唯一能保证"在页面代码发出第一个请求之前就替换好 fetch/XHR"的方式。

---

**Q: `page.setCookie()` 和 CDP `Network.setCookie` 有什么区别？为什么 Cookie 注入必须用前者？**

A: 两个 API 名字像，但操作的层级完全不同。

Puppeteer 控制的是一个 Chrome 进程，进程里有一个浏览器实例，浏览器下面可以开多个标签页（Page）。Cookie 在 Chrome 里存在**浏览器级别**，所有标签页共享。

CDP 里有两种 session：
- **Browser-level session**：和整个浏览器对话
- **Page-level session**：`page.createCDPSession()` 创建，只作用于某一个标签页

在 page-level CDP session 里发 `Network.setCookie` 命令，Cookie 只写入这个标签页的网络上下文——这是 Puppeteer/CDP 内部的一个概念，Chrome 真正发请求时**根本不从这里读**，导致请求头里 Cookie 始终为空。

`page.setCookie()` 是 Puppeteer 封装的高层 API，内部走 Browser-level CDP session，直接操作浏览器级别的真实 cookie store。浏览器发请求时从这里读，所以注入的 Cookie 能真正生效。

两者名字相似，行为完全不同。PerfSim 最初用 `Network.setCookie` 注入，日志显示"注入成功"，`Network.getAllCookies` 也能读到，但实际请求头里 Cookie 是空的——就是因为读写的根本不是同一个 store。修复方案是先导航到目标域建立 origin context，再用 `page.setCookie()` 写入真实 Cookie jar。
