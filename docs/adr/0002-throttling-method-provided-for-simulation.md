# ADR 0002：SimulationEngine 使用 throttlingMethod: 'provided' 而非 'simulate'

**日期**：2026-05-25  
**状态**：已采纳

## 背景

PerfSim 的推演原理：通过 `evaluateOnNewDocument` 注入 fetch/XHR 拦截脚本，让串行链中的 API 请求即时返回缓存数据（耗时接近 0ms），再由 Lighthouse 测量页面，得到"优化后"的指标。

原始实现对 before（基线）和 after（推演）两次 Lighthouse 运行都使用 `throttlingMethod: 'simulate'`，与 DevTools "模拟节流"模式保持一致。

## 问题

`throttlingMethod: 'simulate'` 会激活 Lighthouse 内置的 **Lantern** 网络建模引擎。Lantern **不信任实际观测到的请求时间**，而是：

1. 收集页面加载过程中的原始网络 trace（DevTools Protocol 事件）
2. 用自己的图模型从头重新建模所有请求的时序
3. 基于重建后的时序计算指标——完全忽略真实发生了什么

这意味着：即使我们的注入脚本让 fetch() 在 0ms 内返回，Lantern 看到的 trace 里仍然是原来的网络事件（200ms RTT 等），计算出的 LCP/TTI 和没有优化一样。**拦截对 Lantern 完全不可见。**

通过追踪 Lighthouse 源码中的 `metric.js` 确认：

```js
switch (settings.throttlingMethod) {
  case 'simulate':  return this.computeSimulatedMetric(...)  // ← Lantern，忽略真实时间
  case 'provided':  return this.computeObservedMetric(...)   // ← 信任实际观测时间
}
```

## 决策

**LighthouseRunner（before）和 SimulationEngine（after）都改用 `throttlingMethod: 'provided'`。**

`provided` = "不施加节流，信任实际观测时间"——Lighthouse 直接上报测量到的值，不经过 Lantern 重算。

## 理由

- before/after 必须使用相同的节流模式才能横向对比
- `provided` 是唯一能让我们的 fetch/XHR 拦截效果体现在指标中的模式
- 用户本地网络到测试环境本来就很快，不需要模拟节流
- `simulate` 模式是为了在标准条件下做基准测试设计的；PerfSim 的目标是测量某个具体优化带来的**增量**，不需要产出标准化分数

## 影响

- LCP/TTI 数值会低于 simulate 模式（更接近 DevTools "无节流"时的结果）
- 结果跨次运行的波动会更大（受网络抖动影响）——这也是为什么跑 3 次取中位数
- before/after 对比有效，因为两次使用相同模式
- 分数不可与公开 Lighthouse 报告（使用 simulate 模式）横向比较——可以接受，因为 PerfSim 展示的是**差值**而非绝对分数
