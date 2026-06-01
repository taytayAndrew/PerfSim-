import type { SimulateResult } from '../store'

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

  if (after === null) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-8 text-gray-500">{label}</span>
        <span className="font-mono text-gray-300 w-16 text-right">
          {before != null ? `${Math.round(before)}ms` : '—'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-8 text-gray-500">{label}</span>
      <span className="font-mono text-gray-400 w-16 text-right">
        {before != null ? `${Math.round(before)}ms` : '—'}
      </span>
      <span className="text-gray-600">→</span>
      <span className={`font-mono w-16 text-right font-semibold ${improved ? 'text-emerald-400' : 'text-red-400'}`}>
        {after != null ? `${Math.round(after)}ms` : '—'}
      </span>
      {diff != null && (
        <span className={`ml-auto font-mono ${improved ? 'text-emerald-500' : 'text-red-500'}`}>
          {improved ? '-' : '+'}{Math.abs(Math.round(diff))}ms
        </span>
      )}
    </div>
  )
}

interface Props {
  result: SimulateResult
}

export default function SimulateView({ result }: Props) {
  const { before, after, savedMs, noOptimization, rules } = result as SimulateResult & {
    noOptimization?: boolean
    rules?: Array<{ dynamicUrls?: string[] }>
  }

  // Collect all dynamic URLs across rules
  const dynamicUrls: string[] = []
  if (rules) {
    for (const rule of rules) {
      if (Array.isArray(rule.dynamicUrls)) {
        for (const u of rule.dynamicUrls) {
          const path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
          if (!dynamicUrls.includes(path)) dynamicUrls.push(path)
        }
      }
    }
  }

  if (noOptimization) {
    return (
      <div className="space-y-3">
        <div className="bg-gray-800/60 rounded px-3 py-3 text-center space-y-1">
          <p className="text-sm text-gray-300 font-medium">未发现可优化的请求链</p>
          <p className="text-xs text-gray-500">该页面没有深度 &gt; 2 的 API 串行链，无需模拟优化。</p>
        </div>
        <div className="bg-gray-800/60 rounded px-3 py-2 space-y-2">
          <p className="text-xs text-gray-500 mb-2">当前页面基准指标</p>
          <MetricRow label="LCP" before={before.lcp} after={null} />
          <MetricRow label="FCP" before={before.fcp} after={null} />
          <MetricRow label="TBT" before={before.tbt} after={null} />
          <MetricRow label="TTI" before={before.tti} after={null} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-gray-800/60 rounded px-3 py-2 space-y-2">
        <p className="text-xs text-gray-500 mb-2">Before → After</p>
        <MetricRow label="LCP" before={before.lcp} after={after.lcp} />
        <MetricRow label="FCP" before={before.fcp} after={after.fcp} />
        <MetricRow label="TBT" before={before.tbt} after={after.tbt} />
        <MetricRow label="TTI" before={before.tti} after={after.tti} />
      </div>

      <div className="flex items-center justify-between bg-emerald-900/30 border border-emerald-800 rounded px-3 py-2">
        <span className="text-xs text-emerald-300">理论可节省</span>
        <span className="text-base font-mono font-bold text-emerald-400">
          {Math.round(savedMs)}ms
        </span>
      </div>

      {dynamicUrls.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-800/50 rounded px-3 py-2 space-y-1">
          <p className="text-xs text-amber-400 font-medium">⚠ 以下接口为动态批量接口，无法模拟拦截</p>
          <p className="text-xs text-amber-600/80">每次请求体不同，模拟值未包含这些接口的优化效果。需在代码层面真正实现并行调用。</p>
          <div className="mt-1 space-y-0.5">
            {dynamicUrls.map(u => (
              <p key={u} className="text-xs font-mono text-amber-500/70 truncate">{u}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
