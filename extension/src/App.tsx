import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import AnalyzeView from './components/AnalyzeView'
import SimulateView from './components/SimulateView'

const STEP_LABELS: Record<string, string> = {
  recording: '录制页面网络请求',
  analyzing: '分析串行请求链',
  baseline: '测量优化前基线（约 60s）',
  simulating: '注入优化脚本并测量（约 60s）',
  done: '推演完成',
}

export default function App() {
  const { status, error, url, analyzeResult, simulateResult, progress,
    availableRules, selectedRuleIds, serverOffline,
    fetchRules, toggleRule,
    analyze, simulate, reset, connectPort } = useStore()
  const [currentUrl, setCurrentUrl] = useState<string>('')
  const [importState, setImportState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [importMsg, setImportMsg] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportState('loading')
    setImportMsg('')
    try {
      const source = await file.text()
      const res = await fetch('http://localhost:3000/api/rules/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: source,
      })
      const data = await res.json()
      if (!res.ok) {
        setImportState('error')
        setImportMsg(data.error ?? '导入失败')
      } else {
        setImportState('ok')
        setImportMsg(`已导入：${data.name ?? data.id}`)
        fetchRules() // refresh rule list
      }
    } catch {
      setImportState('error')
      setImportMsg('无法连接到服务器')
    } finally {
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    connectPort()
  }, [connectPort])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.url && tab.url.startsWith('http')) {
        setCurrentUrl(tab.url)
      }
    })
  }, [])

  // Fetch available rules from server on mount
  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const handleAnalyze = () => {
    if (currentUrl) analyze(currentUrl)
  }

  const handleSimulate = () => {
    if (url) simulate(url)
  }

  const isLoading = status === 'analyzing' || status === 'simulating' || status === ('restoring' as string)

  const loadingLabel = (() => {
    if (status === ('restoring' as string)) return '恢复状态…'
    if (status === 'analyzing') {
      return progress?.detail ?? '分析页面中…'
    }
    if (status === 'simulating') {
      const step = progress?.step ?? ''
      return STEP_LABELS[step] ?? progress?.detail ?? '推演优化中…'
    }
    return '处理中…'
  })()

  // Progress steps for simulate phase
  const simulateSteps = ['recording', 'analyzing', 'baseline', 'simulating']
  const currentStepIdx = simulateSteps.indexOf(progress?.step ?? '')

  return (
    <div className="w-80 min-h-48 bg-gray-950 text-gray-100 font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-sm font-semibold tracking-wide text-gray-200">PerfSim</span>
        {(analyzeResult || simulateResult || status === 'error') && (
          <button onClick={reset} className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors">
            重置
          </button>
        )}
      </div>

      {/* URL bar */}
      <div className="px-4 py-2 border-b border-gray-800">
        <p className="text-xs text-gray-500 truncate" title={currentUrl}>
          {currentUrl || '未检测到活动标签页'}
        </p>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Error */}
        {status === 'error' && error && (
          <div className="bg-red-900/40 border border-red-700 rounded px-3 py-2 space-y-2">
            <p className="text-xs text-red-300">{error}</p>
            <button
              onClick={reset}
              className="w-full py-1.5 rounded bg-red-800/50 hover:bg-red-700/50 text-xs text-red-200 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {/* Idle / Analyze button */}
        {status === 'idle' && (
          <div className="space-y-3">
            {serverOffline && (
              <div className="bg-yellow-900/30 border border-yellow-800/50 rounded px-3 py-2 text-xs text-yellow-400">
                ⚠ 无法连接到 PerfSim Server（localhost:3000），请先启动服务
              </div>
            )}

            {/* Rule selection */}
            {availableRules.length > 0 && (
              <div className="bg-gray-800/60 rounded px-3 py-2 space-y-1.5">
                <p className="text-xs text-gray-500 mb-1">选择优化规则</p>
                {availableRules.map(rule => (
                  <label key={rule.id} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedRuleIds.includes(rule.id)}
                      onChange={() => toggleRule(rule.id)}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <div>
                      <span className="text-xs text-gray-300 group-hover:text-gray-100 transition-colors">{rule.name}</span>
                      <span className={`ml-1.5 text-xs px-1 rounded ${rule.confidence === 'high' ? 'text-emerald-500' : 'text-yellow-600'}`}>
                        {rule.confidence}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-700 text-center">更多规则即将推出…</p>

            <button
              onClick={handleAnalyze}
              disabled={!currentUrl || serverOffline || selectedRuleIds.length === 0}
              className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium transition-colors"
            >
              分析页面
            </button>

            {/* Custom rule import */}
            <div className="border-t border-gray-800 pt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".js"
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={serverOffline || importState === 'loading'}
                className="w-full py-1.5 rounded border border-gray-700 hover:border-gray-500 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {importState === 'loading' ? '导入中…' : '导入自定义规则 (.js)'}
              </button>
              {importState === 'ok' && (
                <p className="text-xs text-emerald-500 mt-1 text-center">{importMsg}</p>
              )}
              {importState === 'error' && (
                <p className="text-xs text-red-400 mt-1 text-center">{importMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* Loading states */}
        {isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin h-4 w-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-xs text-gray-300">{loadingLabel}</span>
            </div>

            {/* Step indicators for simulate */}
            {status === 'simulating' && (
              <div className="space-y-1">
                {simulateSteps.map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      i < currentStepIdx ? 'bg-emerald-500' :
                      i === currentStepIdx ? 'bg-blue-400 animate-pulse' :
                      'bg-gray-700'
                    }`} />
                    <span className={`text-xs ${
                      i < currentStepIdx ? 'text-emerald-600' :
                      i === currentStepIdx ? 'text-gray-300' :
                      'text-gray-700'
                    }`}>{STEP_LABELS[step]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Analyze results */}
        {status === 'done' && analyzeResult && !simulateResult && (
          <AnalyzeView result={analyzeResult} onSimulate={handleSimulate} />
        )}

        {/* Simulate results */}
        {status === 'done' && simulateResult && (
          <div className="space-y-3">
            <SimulateView result={simulateResult} />
            <div className="flex items-center gap-2 bg-blue-900/20 border border-blue-800/40 rounded px-3 py-2">
              <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span className="text-xs text-blue-300">完整报告已在新标签页打开</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
