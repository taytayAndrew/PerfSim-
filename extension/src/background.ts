/// <reference types="chrome"/>

import { saveRecord } from './history-store'

const SERVER = 'http://localhost:3000'

export type Status = 'idle' | 'analyzing' | 'simulating' | 'done' | 'error'

export interface SwState {
  status: Status
  error: string | null
  url: string | null
  analyzeResult: unknown | null
  simulateResult: unknown | null
  progress: { step: string; detail: string } | null
}

// Singleton state held in SW memory
let state: SwState = {
  status: 'idle',
  error: null,
  url: null,
  analyzeResult: null,
  simulateResult: null,
  progress: null,
}

// Restore persisted state on SW restart (Chrome kills MV3 SW after 30s inactivity)
let stateRestored = false
const pendingPorts: chrome.runtime.Port[] = []

chrome.storage.local.get('swState', (result) => {
  if (result.swState && typeof result.swState === 'object' && 'status' in result.swState) {
    state = result.swState as SwState
  }
  stateRestored = true
  for (const port of pendingPorts) {
    try { port.postMessage({ type: 'STATE', payload: state }) } catch { /* port closed */ }
  }
  pendingPorts.length = 0
})

// Connected popup ports (for state updates to popup UI)
const popupPorts = new Set<chrome.runtime.Port>()

// Connected content-script ports (for keep-alive + overlay control)
const csPorts = new Set<chrome.runtime.Port>()

function broadcast(newState: SwState) {
  state = newState

  // Persist to storage so state survives SW restart (MV3 kill after 30s inactivity)
  chrome.storage.local.set({ swState: state }).catch(() => {})

  for (const port of popupPorts) {
    try {
      port.postMessage({ type: 'STATE', payload: state })
    } catch {
      popupPorts.delete(port)
    }
  }

  for (const port of csPorts) {
    try {
      port.postMessage({ type: 'STATE', status: state.status })
    } catch {
      csPorts.delete(port)
    }
  }
}

function setState(patch: Partial<SwState>) {
  broadcast({ ...state, ...patch })
}

// ── Keep-alive ───────────────────────────────────────────────────

function startKeepAlive() {
  chrome.alarms.create('keepalive', { periodInMinutes: 1 / 3 })
}

function stopKeepAlive() {
  chrome.alarms.clear('keepalive')
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    chrome.storage.local.get('__keepalive')
  }
})

// ── Friendly error messages ──────────────────────────────────────

function friendlyError(raw: string): string {
  if (raw.includes('LOGIN_REDIRECT')) return 'Cookie 已失效，页面跳转到了登录页，请重新登录后再试'
  if (raw.includes('A simulation is already running')) return '已有推演任务在运行，请稍候再试'
  if (raw.includes('Cookie') || raw.includes('login') || raw.includes('redirect')) return 'Cookie 可能已失效，请重新登录后再试'
  if (raw.includes('NO_LCP') || raw.includes('LanternError')) return '页面未能正常加载（LCP 未检测到），请确认页面可正常访问'
  if (raw.includes('ECONNREFUSED') || raw.includes('fetch')) return '无法连接到 PerfSim 服务，请确认 server 已启动（localhost:3000）'
  if (raw.includes('timeout') || raw.includes('Timeout')) return '页面加载超时，请检查网络或页面响应速度'
  if (raw.includes('net::ERR')) return `网络错误：${raw.match(/net::ERR_\w+/)?.[0] ?? raw.slice(0, 60)}`
  return raw.length > 100 ? raw.slice(0, 100) + '…' : raw
}

async function cancelServerTask() {
  try {
    await fetch(`${SERVER}/api/cancel`, { method: 'POST' })
  } catch { /* server offline — no-op */ }
}

async function doAnalyze(url: string, cookies: chrome.cookies.Cookie[], ruleIds?: string[]) {
  setState({ status: 'analyzing', error: null, url, analyzeResult: null, simulateResult: null, progress: { step: 'recording', detail: '录制页面网络请求…' } })
  startKeepAlive()
  try {
    const res = await fetch(`${SERVER}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookies, ruleIds }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? res.statusText)
    }
    const data = await res.json()
    setState({ status: 'done', analyzeResult: data, progress: null })
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e)
    setState({ status: 'error', error: friendlyError(raw), progress: null })
  } finally {
    stopKeepAlive()
  }
}

async function doSimulate(url: string, cookies: chrome.cookies.Cookie[], analyzeResult: unknown, ruleIds?: string[]) {
  const progressId = Math.random().toString(36).slice(2)
  setState({ status: 'simulating', error: null, simulateResult: null, progress: { step: 'starting', detail: '准备推演…' } })
  startKeepAlive()

  // Open SSE stream before POST so server can emit progress immediately
  let sseAbort: AbortController | null = new AbortController()
  const sseUrl = `${SERVER}/api/simulate/progress?id=${progressId}`

  ;(async () => {
    try {
      const sseRes = await fetch(sseUrl, { signal: sseAbort!.signal })
      if (!sseRes.body) return
      const reader = sseRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.slice(6))
              setState({ progress: { step: evt.step, detail: evt.detail } })
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch {
      // SSE closed or aborted — normal on completion
    }
  })()

  try {
    const ar = analyzeResult as { rules?: unknown; metrics?: unknown } | null
    const rules = ar?.rules
    const baselineMetrics = ar?.metrics
    const res = await fetch(`${SERVER}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, cookies, rules, baselineMetrics, progressId, ruleIds }),
    })
    sseAbort?.abort()
    sseAbort = null

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? res.statusText)
    }
    const data = await res.json()
    setState({ status: 'done', simulateResult: data, progress: null })

    // Persist to IndexedDB and open ReportTab
    try {
      await saveRecord({
        timestamp: Date.now(),
        url: url,
        simulateResult: data,
        analyzeResult: analyzeResult,
      })
    } catch (e) {
      console.warn('[perfsim] Failed to save to IndexedDB:', e)
    }

    const reportUrl = chrome.runtime.getURL('report.html')
    const existingTabs = await chrome.tabs.query({ url: reportUrl })
    if (existingTabs.length > 0 && existingTabs[0].id != null) {
      await chrome.tabs.reload(existingTabs[0].id)
      await chrome.tabs.update(existingTabs[0].id, { active: true })
    } else {
      await chrome.tabs.create({ url: reportUrl })
    }
  } catch (e: unknown) {
    sseAbort?.abort()
    const raw = e instanceof Error ? e.message : String(e)
    setState({ status: 'error', error: friendlyError(raw), progress: null })
  } finally {
    stopKeepAlive()
  }
}

// ── Port lifecycle ────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port)
    if (stateRestored) {
      port.postMessage({ type: 'STATE', payload: state })
    } else {
      pendingPorts.push(port)
    }

    port.onMessage.addListener((msg: { type: string; url?: string; cookies?: chrome.cookies.Cookie[]; ruleIds?: string[] }) => {
      if (msg.type === 'ANALYZE' && msg.url) {
        if (state.status !== 'analyzing' && state.status !== 'simulating') {
          doAnalyze(msg.url, msg.cookies ?? [], msg.ruleIds)
        }
      } else if (msg.type === 'SIMULATE' && msg.url) {
        if (state.status !== 'analyzing' && state.status !== 'simulating') {
          doSimulate(msg.url, msg.cookies ?? [], state.analyzeResult, msg.ruleIds)
        }
      } else if (msg.type === 'RESET') {
        if (state.status === 'analyzing' || state.status === 'simulating') {
          cancelServerTask()
        }
        setState({ status: 'idle', error: null, url: null, analyzeResult: null, simulateResult: null, progress: null })
      }
    })

    port.onDisconnect.addListener(() => {
      popupPorts.delete(port)
    })

  } else if (port.name === 'content-script') {
    csPorts.add(port)
    port.postMessage({ type: 'STATE', status: state.status })

    port.onMessage.addListener((msg: { type: string; url?: string }) => {
      if (msg.type === 'LOGIN_REDIRECT') {
        if (state.status === 'analyzing' || state.status === 'simulating') {
          cancelServerTask()
          setState({ status: 'error', error: 'Cookie 可能已失效，页面跳转到登录页', progress: null })
        }
      }
    })

    port.onDisconnect.addListener(() => {
      csPorts.delete(port)
    })
  }
})
