import { useState } from 'react'
import type { AnalyzeResult } from '../store'

function MetricBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-center bg-gray-800 rounded px-3 py-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-mono font-semibold text-gray-100">
        {value != null ? `${Math.round(value)}ms` : '—'}
      </span>
    </div>
  )
}

interface ChainRequest {
  url: string
  method: string
  startTime: number
  endTime: number
  status: number
}

function ChainItem({ chain, index }: { chain: { requests: ChainRequest[] }; index: number }) {
  const requests = chain.requests ?? []
  const totalMs = requests.length >= 2
    ? Math.round(requests[requests.length - 1].endTime - requests[0].startTime)
    : 0

  return (
    <div className="bg-gray-800/50 rounded p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">串行链 #{index + 1}</span>
        <span className="text-xs font-mono text-amber-400">{totalMs}ms</span>
      </div>
      {requests.map((req, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <span className={`shrink-0 text-xs font-mono ${i === 0 ? 'text-blue-400' : 'text-gray-600'}`}>
            {i === 0 ? '→' : `↳`}
          </span>
          <span className="font-mono text-gray-500 shrink-0">
            {Math.round(req.endTime - req.startTime)}ms
          </span>
          <span className="text-gray-400 truncate" title={req.url}>
            {req.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}
          </span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  result: AnalyzeResult
  onSimulate: () => void
}

export default function AnalyzeView({ result, onSimulate }: Props) {
  const { metrics, rules, chains } = result
  const [showChains, setShowChains] = useState(false)
  const topRule = rules[0]
  const savedMs = topRule?.savedMs ?? 0
  const chainCount = chains.length

  const severityLabel = topRule?.severity === 'high' ? '高' : topRule?.severity === 'medium' ? '中' : '低'
  const severityColor = topRule?.severity === 'high' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="space-y-3">
      {/* Baseline metrics */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">基线指标</p>
        <div className="grid grid-cols-4 gap-1">
          <MetricBadge label="LCP" value={metrics.lcp} />
          <MetricBadge label="FCP" value={metrics.fcp} />
          <MetricBadge label="TBT" value={metrics.tbt} />
          <MetricBadge label="TTI" value={metrics.tti} />
        </div>
      </div>

      {/* Chain summary */}
      <div className="bg-gray-800/60 rounded px-3 py-2 space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-gray-400">发现串行链</span>
          <span className="font-mono text-amber-400">{chainCount} 条</span>
        </div>
        {topRule && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">规则</span>
              <span className="text-blue-400">{topRule.ruleName}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">严重程度</span>
              <span className={severityColor}>{severityLabel}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">理论可节省</span>
              <span className="font-mono text-emerald-400 font-semibold">{savedMs}ms</span>
            </div>
          </>
        )}

        {/* Chain list toggle */}
        {chainCount > 0 && (
          <button
            onClick={() => setShowChains(v => !v)}
            className="w-full text-left text-xs text-gray-500 hover:text-gray-300 pt-1 transition-colors flex items-center gap-1"
          >
            <svg className={`w-3 h-3 transition-transform ${showChains ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            {showChains ? '收起' : '展开'}串行链详情
          </button>
        )}
      </div>

      {/* Chain list */}
      {showChains && chainCount > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {(chains as Array<{ requests: ChainRequest[] }>).map((chain, i) => (
            <ChainItem key={i} chain={chain} index={i} />
          ))}
        </div>
      )}

      {/* Simulate button */}
      <button
        onClick={onSimulate}
        className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
      >
        开始推演优化
      </button>
    </div>
  )
}
