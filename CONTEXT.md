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
