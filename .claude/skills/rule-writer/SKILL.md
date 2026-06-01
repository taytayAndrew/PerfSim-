---
name: rule-writer
description: PerfSim 优化规则编写助手。通过问答引导用户明确优化点，生成符合 PerfSim 规则契约的规则脚本，并自动写入 server/rules/ 目录。Use when user wants to add a new optimization rule, write a new rule, or says "写规则"/"新增规则"/"优化点".
---

# PerfSim Rule Writer

通过问答确定优化方案，生成符合规则契约的 JS 规则文件。

## 时序判断规范

写涉及请求时序的规则时，注意两个容差常量：

| 常量 | 值 | 用途 |
|------|----|------|
| `SERIAL_GAP_MS = 150` | 串行链上限 | B.startTime <= A.endTime + 150，才认为 B 是被 A 驱动的（覆盖 JSON.parse + React re-render 耗时） |
| `SERIAL_TOLERANCE_MS = 20` | 去重下限容差 | B.startTime >= A.endTime - 20，容忍 CDP 时间戳采样误差（B 看起来比 A 早结束一点点，但实际是串行） |

**并行重复不是性能优化项**：两个请求同时在飞，删掉一个不影响 LCP，只减少服务器压力。不应进入 `findings`，可在 summary 里说明。

```js
export const id = 'rule-xxx'           // 唯一 ID，kebab-case
export const name = '中文名称'
export const description = '...'
export const confidence = 'high' | 'medium' | 'low'

export function analyze({ recording, chains }) → {
  severity,       // 'high' | 'medium' | 'info'
  affectsLCP,     // boolean
  findings,       // ⚠️ 必须用 findings 字段（不能用 chains/duplicates 等自定义名）
                  // 值为"发现的问题项数组"，结构由规则自己定义
                  // pipeline 靠 findings.length > 0 判断是否跑 Lighthouse 模拟
  summary,        // 中文一句话描述
  ...自定义字段   // 可以加，但不影响 pipeline
}
export function calculateTheoretical(analysisResult) → { savedMs }
export function buildScript(analysisResult, recordingData) → string  // 注入脚本
export function buildHtml() → string   // 通常返回 ''
export function buildCard(finding, index) → {
  title: string,   // 如 '串行链 #1'、'重复请求 #1'
  badge: string,   // 右上角摘要，如 '3 个请求 · 可节省 200ms'
  rows: Array<{
    label: string,    // 行标签，如 '首次调用'、'第 2 跳'
    ms: number,       // 耗时（毫秒）
    url: string,      // 请求 URL（完整）
    highlight: boolean, // true = 红色标注（问题行），false = 蓝色（正常行）
  }>
}
```

> **`findings` 是框架契约字段，所有规则必须返回它。**
> 语义上你的数据叫 duplicates / groups / issues 都行，但必须同时挂在 `findings` 上。
> 示例：`findings: duplicates` 或 `findings: qualifiedChains`

## 问答流程（每次只问一个问题）

### Q1 — 优化点描述
"你想优化什么？请描述现象（比如：某个接口被调用了多次、某个请求发得太晚）"

### Q2 — 能否通过注入脚本模拟？
根据用户描述判断：
- **可模拟**：拦截 fetch/XHR 返回缓存/空响应/提前响应
- **仅分析**：只能在报告里标注，给出建议

若可模拟，问："注入脚本希望实现什么效果？"
- 缓存首次响应，后续命中 → 去重
- 提前发出请求并缓存 → 请求前移  
- 立即返回空响应 → 屏蔽非关键请求

### Q3 — 触发条件
"什么样的请求/场景才算触发这个规则？"
例：同一 cacheKey 出现 ≥2 次 / URL 包含某关键词 / 响应时间 > N ms

### Q4 — severity 判断标准
"什么情况算 high？什么算 medium？"
例：浪费时间 > 500ms → high

### Q5（可选）— 特殊过滤
"需要排除哪些请求？"
例：只处理 JSON API / 排除静态资源 / 排除 SW 缓存命中

## 实现规范

### analyze() 规范
```js
export function analyze({ recording, chains }) {
  const allRequests = recording?.requests ?? []
  // 1. 过滤出目标请求（isApiRequest / URL 特征 / 响应时间等）
  // 2. 找出触发条件的请求集合
  // 3. 计算 severity 和 summary
  return { severity, affectsLCP, summary, /* 自定义字段传给 buildScript */ }
}
```

### buildScript() 规范
- 必须返回合法 JS 字符串，可直接传给 `evaluateOnNewDocument`
- 空操作时返回 `';(function(){})();'`
- 拦截模板见 [REFERENCE.md](REFERENCE.md)

### cacheKey 格式
`METHOD:normalizedURL:md5(body)` — 由 RecordingEngine 生成，请求对象上有 `req.cacheKey` 字段，直接用即可。

## 输出

生成规则文件写入 `D:\perfsim\server\rules\rule-{id}.js`，并提示用户重启 server（server 启动时自动加载 rules/ 目录）。

## 已有规则（避免重复）
- `rule-serial-chain` — 串行请求链并行化
- `rule-dedup-requests` — 重复请求去重
