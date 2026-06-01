import { useEffect, useState } from 'react'
import { getAllRecords, type HistoryRecord } from '../history-store'
import type { SimulateResult, AnalyzeResult, Metrics } from '../store'

function MetricRow({
  label,
  before,
  after,
}: {
  label: string
  before: number | null
  after: number | null
}) {
  const diff = before != null && after != null ? before - after : null
  const improved = diff != null && diff > 0
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-10 text-gray-500 shrink-0">{label}</span>
      <span className="font-mono text-gray-400 w-20 text-right">
        {before != null ? `${Math.round(before)}ms` : '—'}
      </span>
      <span className="text-gray-600">→</span>
      <span className={`font-mono w-20 text-right font-semibold ${after == null ? 'text-gray-400' : improved ? 'text-emerald-400' : 'text-red-400'}`}>
        {after != null ? `${Math.round(after)}ms` : '—'}
      </span>
      {diff != null && (
        <span className={`ml-2 font-mono text-xs ${improved ? 'text-emerald-500' : 'text-red-500'}`}>
          {improved ? '-' : '+'}{Math.abs(Math.round(diff))}ms
        </span>
      )}
    </div>
  )
}

type CardRow = { label: string; ms: number; url: string; highlight: boolean }
type CardData = { title: string; badge: string; rows: CardRow[] }
type ChainRequest = { url: string; startTime: number; endTime: number; method: string }
type Chain = ChainRequest[] | { requests: ChainRequest[] }

function FindingCard({ card }: { card: CardData }) {
  return (
    <div className="bg-gray-800/60 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-300">{card.title}</span>
        <span className="text-xs text-amber-400 font-mono">{card.badge}</span>
      </div>
      <div className="space-y-1.5">
        {card.rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-mono ${row.highlight ? 'bg-red-900/50 text-red-300' : 'bg-blue-900/50 text-blue-300'}`}>
              {row.label}
            </span>
            <span className="font-mono text-gray-400 text-xs shrink-0">
              {row.ms}ms
            </span>
            <span className="text-gray-500 truncate" title={row.url}>
              {row.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function exportHtml(record: HistoryRecord) {
  const sim = record.simulateResult as SimulateResult
  const analyze = record.analyzeResult as AnalyzeResult | null
  const before = sim.before as Metrics
  const after = sim.after as Metrics

  const metricRow = (label: string, b: number | null, a: number | null) => {
    const diff = b != null && a != null ? b - a : null
    const improved = diff != null && diff > 0
    return `<tr>
      <td style="padding:6px 12px;color:#9ca3af">${label}</td>
      <td style="padding:6px 12px;font-family:monospace;text-align:right;color:#9ca3af">${b != null ? Math.round(b) + 'ms' : '—'}</td>
      <td style="padding:6px 12px;text-align:center;color:#4b5563">→</td>
      <td style="padding:6px 12px;font-family:monospace;text-align:right;color:${a == null ? '#9ca3af' : improved ? '#34d399' : '#f87171'}">${a != null ? Math.round(a) + 'ms' : '—'}</td>
      <td style="padding:6px 12px;font-family:monospace;color:${improved ? '#10b981' : '#ef4444'}">${diff != null ? (improved ? '-' : '+') + Math.abs(Math.round(diff)) + 'ms' : ''}</td>
    </tr>`
  }

  const chains = (analyze?.chains ?? []) as Chain[]
  const chainHtml = chains.map((chain, i) => {
    const reqs: ChainRequest[] = Array.isArray(chain) ? chain : (chain.requests ?? [])
    const totalMs = reqs.length >= 2 ? Math.round(reqs[reqs.length - 1].endTime - reqs[0].startTime) : 0
    const rows = reqs.map((req, j) => `<div style="display:flex;gap:8px;font-size:12px;margin:4px 0">
      <span style="color:${j === 0 ? '#93c5fd' : '#6b7280'};font-family:monospace;min-width:40px">${j === 0 ? '发起' : '#' + (j + 1)}</span>
      <span style="color:#6b7280;font-family:monospace;min-width:40px">${Math.round(req.endTime - req.startTime)}ms</span>
      <span style="color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${req.url}">${req.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}</span>
    </div>`).join('')
    return `<div style="background:#1f2937;border-radius:8px;padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:#d1d5db">串行链 #${i + 1}</span>
        <span style="color:#fbbf24;font-family:monospace">${totalMs}ms 总延迟</span>
      </div>
      ${rows}
    </div>`
  }).join('')

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>PerfSim 推演报告 — ${record.url}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#030712;color:#f9fafb}h1,h2{margin:0}table{border-collapse:collapse;width:100%}</style>
</head>
<body style="padding:40px;max-width:900px;margin:0 auto">
  <h1 style="font-size:24px;color:#f9fafb;margin-bottom:4px">PerfSim 推演报告</h1>
  <p style="color:#6b7280;font-size:14px;margin-bottom:8px">${record.url}</p>
  <p style="color:#4b5563;font-size:12px;margin-bottom:32px">${new Date(record.timestamp).toLocaleString('zh-CN')}</p>

  <h2 style="font-size:16px;color:#d1d5db;margin-bottom:16px">指标对比</h2>
  <table style="margin-bottom:32px">
    <thead><tr>
      <th style="padding:6px 12px;text-align:left;color:#6b7280;font-weight:normal;font-size:12px">指标</th>
      <th style="padding:6px 12px;text-align:right;color:#6b7280;font-weight:normal;font-size:12px">优化前</th>
      <th></th>
      <th style="padding:6px 12px;text-align:right;color:#6b7280;font-weight:normal;font-size:12px">优化后</th>
      <th style="padding:6px 12px;color:#6b7280;font-weight:normal;font-size:12px">差值</th>
    </tr></thead>
    <tbody>
      ${metricRow('LCP', before.lcp, after.lcp)}
      ${metricRow('FCP', before.fcp, after.fcp)}
      ${metricRow('TBT', before.tbt, after.tbt)}
      ${metricRow('TTI', before.tti, after.tti)}
    </tbody>
  </table>

  <div style="background:#064e3b;border:1px solid #065f46;border-radius:8px;padding:16px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:center">
    <span style="color:#6ee7b7;font-size:14px">理论可节省</span>
    <span style="color:#34d399;font-size:24px;font-family:monospace;font-weight:bold">${Math.round(sim.savedMs)}ms</span>
  </div>

  ${chains.length > 0 ? `<h2 style="font-size:16px;color:#d1d5db;margin-bottom:16px">串行请求链（${chains.length} 条）</h2>${chainHtml}` : ''}
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `perfsim-report-${new Date(record.timestamp).toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

type RuleResult = {
  ruleId: string
  ruleName: string
  severity: 'high' | 'medium' | 'info'
  summary: string
  savedMs?: number
  findings?: unknown[]
  cards?: CardData[]
  dynamicUrls?: string[]
}

function Conclusion({ sim, before, after }: {
  sim: SimulateResult
  before: Metrics | null
  after: Metrics | null
}) {
  const savedMs = Math.round(sim.savedMs ?? 0)
  const lcpBefore = before?.lcp ?? null
  const lcpAfter = after?.lcp ?? null
  const lcpDiff = lcpBefore != null && lcpAfter != null ? lcpBefore - lcpAfter : null
  const noOptimization = (sim as any).noOptimization === true
  const rules: RuleResult[] = (sim as any)?.rules ?? []

  // Active rules = rules that found something (not info-level)
  const activeRules = rules.filter(r => r.severity !== 'info')
  const highRules = activeRules.filter(r => r.severity === 'high')
  const hasAnyFindings = activeRules.length > 0

  let verdict = ''
  let verdictColor = 'text-gray-300'
  let badge = ''
  let badgeColor = ''

  if (noOptimization || !hasAnyFindings) {
    // No rule found anything actionable
    const ruleNames = rules.map(r => r.ruleName).join('、')
    verdict = `已检测规则（${ruleNames || '无'}）均未发现可优化项。若 LCP 仍较慢，瓶颈可能在后端响应速度或关键资源加载顺序。`
    badge = '未发现优化空间'
    badgeColor = 'bg-gray-700 text-gray-300'
  } else if (highRules.length > 0 && lcpDiff != null && lcpDiff >= 500) {
    const names = highRules.map(r => r.ruleName).join(' + ')
    verdict = `通过【${names}】优化，LCP 可从 ${Math.round(lcpBefore!)}ms 降至约 ${Math.round(lcpAfter!)}ms，提升 ${Math.round(lcpDiff)}ms。这是高价值前端优化，建议优先落地。`
    badge = '高价值前端优化'
    badgeColor = 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
    verdictColor = 'text-emerald-100'
  } else if (hasAnyFindings && lcpDiff != null && lcpDiff >= 200) {
    const names = activeRules.map(r => r.ruleName).join(' + ')
    verdict = `通过【${names}】优化，预计可改善 LCP ${Math.round(lcpDiff)}ms。收益中等，建议结合后端优化一起推进。`
    badge = '中等前端优化收益'
    badgeColor = 'bg-blue-900/50 text-blue-300 border border-blue-800'
    verdictColor = 'text-blue-100'
  } else if (savedMs > 0) {
    const names = activeRules.map(r => r.ruleName).join(' + ')
    verdict = `发现优化空间（${names}），理论节省 ${savedMs}ms，但 LCP 改善幅度较小（${lcpDiff != null ? Math.round(lcpDiff) + 'ms' : '数据不足'}）。LCP 瓶颈可能在其他资源（JS/CSS/图片）或后端响应速度。`
    badge = '前端优化收益有限'
    badgeColor = 'bg-amber-900/40 text-amber-300 border border-amber-800'
    verdictColor = 'text-amber-100'
  } else {
    verdict = '未发现明显的前端优化空间。建议检查后端 API 响应时间、CDN 配置和关键资源预加载。'
    badge = '建议排查后端/网络'
    badgeColor = 'bg-gray-800 text-gray-400'
  }

  return (
    <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-400">推演结论</h2>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${badgeColor}`}>{badge}</span>
      </div>
      <p className={`text-sm leading-relaxed ${verdictColor}`}>{verdict}</p>
      {/* Per-rule findings */}
      {rules.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-800">
          {rules.map(r => (
            <div key={r.ruleId} className="flex items-start gap-2 text-xs">
              <span className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${r.severity === 'high' ? 'bg-red-400' : r.severity === 'medium' ? 'bg-amber-400' : 'bg-gray-600'}`} />
              <span className="text-gray-500 shrink-0">{r.ruleName}：</span>
              <span className="text-gray-400">{r.summary}</span>
            </div>
          ))}
        </div>
      )}
      {hasAnyFindings && savedMs > 0 && (
        <p className="text-xs text-gray-600">
          置信度：中等（基于 Lighthouse × 3 中位值，provided 模式，无 Lantern 修正）
        </p>
      )}
    </div>
  )
}

export default function ReportTab() {
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAllRecords().then(rs => {
      setRecords(rs)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400 text-sm">
        加载中…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-400 gap-3">
        <p className="text-lg text-gray-300">暂无推演记录</p>
        <p className="text-sm text-gray-600">在 PerfSim 插件中完成一次推演后，报告将自动显示在这里。</p>
      </div>
    )
  }

  const record = records[selectedIdx]
  const sim = record.simulateResult as SimulateResult
  const before = sim?.before as Metrics | null
  const after = sim?.after as Metrics | null

  // Rule results with chains and dynamicUrls
  const rules: RuleResult[] = (sim as any)?.rules ?? []
  const dynamicUrls: string[] = []
  for (const rule of rules) {
    if (Array.isArray(rule.dynamicUrls)) {
      for (const u of rule.dynamicUrls) {
        const p = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
        if (!dynamicUrls.includes(p)) dynamicUrls.push(p)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="font-semibold text-gray-200 tracking-wide">PerfSim 推演报告</span>
        </div>
        <button
          onClick={() => exportHtml(record)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          导出 HTML
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* History selector */}
        {records.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 shrink-0">历史记录：</span>
            <div className="flex gap-2 flex-wrap">
              {records.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedIdx(i)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${i === selectedIdx ? 'bg-blue-700 text-blue-100' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {new Date(r.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* URL + timestamp */}
        <div>
          <p className="text-sm text-gray-400 truncate" title={record.url}>{record.url}</p>
          <p className="text-xs text-gray-600 mt-0.5">{new Date(record.timestamp).toLocaleString('zh-CN')}</p>
        </div>

        {/* Conclusion — PM layer */}
        <Conclusion sim={sim} before={before} after={after} />

        {/* Metrics */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 mb-4">指标对比 Before → After</h2>
          <div className="bg-gray-900 rounded-xl p-6 space-y-3">
            <MetricRow label="LCP" before={before?.lcp ?? null} after={after?.lcp ?? null} />
            <MetricRow label="FCP" before={before?.fcp ?? null} after={after?.fcp ?? null} />
            <MetricRow label="TBT" before={before?.tbt ?? null} after={after?.tbt ?? null} />
            <MetricRow label="TTI" before={before?.tti ?? null} after={after?.tti ?? null} />
          </div>
        </section>

        {/* Saved */}
        <div className="flex items-center justify-between bg-emerald-900/30 border border-emerald-800 rounded-xl px-6 py-4">
          <span className="text-sm text-emerald-300">前端优化理论可节省</span>
          <span className="text-3xl font-mono font-bold text-emerald-400">{Math.round(sim?.savedMs ?? 0)}ms</span>
        </div>

        {/* Dynamic URL warning */}
        {dynamicUrls.length > 0 && (
          <div className="bg-amber-900/20 border border-amber-800/50 rounded-xl px-5 py-4 space-y-2">
            <p className="text-sm text-amber-400 font-medium">⚠ 以下接口为动态批量接口，无法模拟拦截</p>
            <p className="text-xs text-amber-600/80">每次请求体不同，模拟值未包含这些接口的优化效果。需在代码层面真正实现并行调用。</p>
            <div className="space-y-0.5 mt-1">
              {dynamicUrls.map(u => (
                <p key={u} className="text-xs font-mono text-amber-500/70 truncate">{u}</p>
              ))}
            </div>
          </div>
        )}

        {/* Rule findings — grouped by rule */}
        {rules && rules.filter((r: RuleResult) => Array.isArray(r.cards) && r.cards.length > 0).map((rule: RuleResult) => (
          <section key={rule.ruleId}>
            <h2 className="text-sm font-medium text-gray-400 mb-4">
              {rule.ruleName}
              <span className="ml-2 text-xs text-gray-600">（{rule.cards!.length} 条）</span>
            </h2>
            <div className="space-y-3">
              {rule.cards!.map((card, i) => (
                <FindingCard key={i} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
