# PerfSim Platform — Domain Glossary

> Pure glossary. No implementation details, no specs, no decisions.

---

## Core Concepts

**PerfSim Platform**
A frontend performance simulation tool that predicts the performance improvement of optimization strategies without modifying production code.

**Recording Phase (录制阶段)**
Phase 1 of the two-phase workflow. Puppeteer loads the target page with CDP interception active, capturing all network request/response pairs and their timing. The baseline Lighthouse run also happens here.

**Simulation Phase (推演阶段)**
Phase 2. An optimization script is injected via `evaluateOnNewDocument`, causing serial-chain requests to be served from cache (near-zero latency). Lighthouse then measures the simulated page.

**Serial Request Chain (串行请求链)**
A sequence of HTTP requests where each request is causally dependent on the previous one's response data — i.e., B cannot start until A's response is received and parsed. These are the primary optimization target.

**Rule (规则)**
A pluggable optimization strategy. Each rule is a JavaScript module implementing three methods: `analyze`, `calculateTheoretical`, and `buildScript`.

**Rule Contract (规则三件事契约)**
The interface every rule must implement:
- `analyze(recordingData)` → identifies the problem in recorded data
- `calculateTheoretical(analysisResult, lighthouseData)` → estimates performance gain
- `buildScript(analysisResult, cacheData)` → generates the injection script string

**Injection Script (注入脚本)**
A pre-written JavaScript closure injected via `evaluateOnNewDocument`. It intercepts `fetch`/`XHR` calls and returns cached responses for serial-chain URLs, simulating parallel loading.

**Theoretical Prediction (理论推演)**
A calculated estimate of performance improvement based on request timing analysis. Shows the upper bound of potential gain. Confidence level: medium (timing correlation, not causal proof).

**Real Simulation (真实推演)**
An actual Lighthouse run with the injection script active. Produces measured before/after metrics.

**Confidence Level (置信度)**
A fixed value set by the rule author indicating how reliable the theoretical prediction is. Stored in the rule definition, shown in analysis results.

**Session (会话)**
A recording + simulation pair linked by a session ID. Temporary files are created per session and cleaned up after simulation completes or fails.

**Baseline (基线)**
The Lighthouse measurement of the unmodified page taken during the Recording Phase. Used as the "before" value in before/after comparisons.

**Cache Key (缓存键)**
The identifier used to store and retrieve recorded responses: `URL + HTTP method + hash(requestBody)`.

**Serial Chain False Positive (假串行)**
An HTTP/2 request sequence that appears sequential in timing but has no actual data dependency. Detected by checking whether B's request parameters contain values from A's response.

**Service Worker (SW)**
The browser's SW is not disabled during simulation. During recording, response sources are tagged (SW cache vs network). The injection script only intercepts network-sourced serial-chain requests.

---

## Components

**Chrome Extension**
The user-facing UI layer. A Chrome MV3 extension with Popup (rule selection + analysis summary) and a separate Report Tab (full before/after results).

**Node.js Server**
The local computation backend. Runs Puppeteer and Lighthouse. Exposes HTTP + SSE endpoints. Runs on `localhost:3000` by default.

**Content Script**
An Extension component injected into the target page. Maintains a `chrome.runtime.connect()` Port connection to keep the Extension Service Worker alive during long Lighthouse runs (45–60s).

**Popup**
The Extension's primary UI. Shows rule selection list and analysis summary. Report details open in a new tab.

**Report Tab**
A full-page tab showing the complete simulation report including serial chain list, before/after metrics, and confidence levels. Supports HTML export.

**Conclusion Layer (结论摘要层)**
The top section of the Report Tab. Designed for product managers. Shows a single-sentence verdict: how much LCP/FCP can improve through frontend optimization, and what remains as a backend/network problem. Technical details are collapsed below.

**Preload Rule (预加载规则)**
The second built-in rule. Detects critical resources (JS/CSS/images) that are discovered too late during page load. Simulates adding `<link rel="preload">` tags via script injection and measures the FCP/LCP improvement.

**Cold Start (冷启动)**
The scenario PerfSim always measures: a brand-new Chrome instance with no browser cache, no active Service Worker, loading the page for the first time. This matches the semantics of LCP/FCP/TTI metrics and is the explicit scope boundary of PerfSim.

**Throttling Mode — Provided vs Simulate (节流模式)**
Lighthouse supports two throttling modes relevant to PerfSim:
- `simulate`：激活 Lantern 网络建模引擎，从原始 trace 重新建模时序，**不信任实际观测时间**。我们的 fetch 拦截对它不可见。
- `provided`：直接信任实际观测时间，不做任何重算。**PerfSim 必须用这个模式**，否则注入脚本的效果完全无法体现在指标中。
详见 ADR 0002。

**CDP-level Cookie Injection (CDP 级别 Cookie 注入)**
通过 `client.send('Network.setCookie', ...)` 在浏览器 profile 级别设置 Cookie，对所有 tab 生效。与之对比，`page.setCookie()` 只作用于单个 tab——当 Lighthouse 内部新开 tab 时，Cookie 会丢失，导致 SSO 重定向和 `LanternError: NO_LCP`。PerfSim 的所有 Lighthouse 运行必须使用 CDP 级别注入。详见 ADR 0003。

**Injection Script Heartbeat (注入脚本心跳)**
注入脚本的第一行必须打印 `[perfsim] script loaded, ENTRIES=N`。如果 server 日志里没有 `PAGE: [perfsim] script loaded`，说明脚本未执行（可能是语法错误或注册时机问题）。这是验证注入是否生效的唯一可靠手段。详见 ADR 0004。

**pickMedian Null Filtering (中位数空值过滤)**
每次 Lighthouse 运行独立 try-catch，失败时记录 `{ lcp: null, ... }`。`pickMedian` 在排序前过滤掉 null LCP 的结果，只从有效运行中取中位数。如果全部运行都失败，返回 null，上层调用方需处理。
