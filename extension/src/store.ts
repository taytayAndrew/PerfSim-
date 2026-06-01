import { create } from 'zustand'
import type { SwState } from './background'

export type { Status } from './background'
export type { SwState } from './background'

const SERVER = 'http://localhost:3000'

export interface Metrics {
  lcp: number | null
  fcp: number | null
  tbt: number | null
  tti: number | null
}

export interface ChainRequest {
  url: string
  method: string
  startTime: number
  endTime: number
  status: number
}

export interface Chain {
  requests: ChainRequest[]
  totalDelayMs: number
  confirmedLinks: number
}

export interface Rule {
  ruleId: string
  ruleName: string
  severity: string
  affectsLCP: boolean
  chains: Chain[]
  summary: string
  savedMs: number
}

export interface AvailableRule {
  id: string
  name: string
  description: string
  confidence: string
}

export interface AnalyzeResult {
  sessionId: string
  url: string
  metrics: Metrics
  chains: Chain[]
  rules: Rule[]
  loginRedirect: boolean
  recordedAt: string
}

export interface SimulateResult {
  sessionId: string
  url: string
  before: Metrics
  after: Metrics
  savedMs: number
  rules: Rule[]
}

interface PerfSimStore extends SwState {
  analyzeResult: AnalyzeResult | null
  simulateResult: SimulateResult | null
  progress: { step: string; detail: string } | null
  port: chrome.runtime.Port | null
  availableRules: AvailableRule[]
  selectedRuleIds: string[]
  serverOffline: boolean
  fetchRules: () => void
  toggleRule: (id: string) => void
  connectPort: () => void
  analyze: (url: string) => void
  simulate: (url: string) => void
  reset: () => void
  _applyState: (s: SwState) => void
}

export const useStore = create<PerfSimStore>((set, get) => ({
  status: 'idle',
  error: null,
  url: null,
  analyzeResult: null,
  simulateResult: null,
  progress: null,
  port: null,
  availableRules: [],
  selectedRuleIds: [],
  serverOffline: false,

  fetchRules: () => {
    fetch(`${SERVER}/api/rules`)
      .then(r => r.json())
      .then((rules: AvailableRule[]) => {
        set(state => ({
          availableRules: rules,
          serverOffline: false,
          // Auto-select all rules if nothing selected yet
          selectedRuleIds: state.selectedRuleIds.length === 0
            ? rules.map(r => r.id)
            : state.selectedRuleIds,
        }))
      })
      .catch(() => {
        set({ serverOffline: true })
      })
  },

  toggleRule: (id: string) => {
    set(state => {
      const selected = state.selectedRuleIds
      return {
        selectedRuleIds: selected.includes(id)
          ? selected.filter(r => r !== id)
          : [...selected, id],
      }
    })
  },

  connectPort: () => {
    const existing = get().port
    if (existing) return

    const port = chrome.runtime.connect({ name: 'popup' })

    port.onMessage.addListener((msg: { type: string; payload: SwState }) => {
      if (msg.type === 'STATE') {
        get()._applyState(msg.payload)
      }
    })

    port.onDisconnect.addListener(() => {
      set({ port: null, status: 'idle' })
      set({ status: 'restoring' as any })
      setTimeout(() => get().connectPort(), 100)
    })

    set({ port, status: 'restoring' as any })
  },

  analyze: (url: string) => {
    const { selectedRuleIds } = get()
    const hostname = new URL(url).hostname
    const parts = hostname.split('.')
    const rootDomain = parts.slice(-2).join('.')
    chrome.cookies.getAll({}, (allCookies) => {
      const cookies = allCookies.filter(c => c.domain.includes(rootDomain))
      get().port?.postMessage({
        type: 'ANALYZE',
        url,
        cookies,
        ruleIds: selectedRuleIds.length > 0 ? selectedRuleIds : undefined,
      })
    })
  },

  simulate: (url: string) => {
    const { selectedRuleIds } = get()
    const hostname = new URL(url).hostname
    const parts = hostname.split('.')
    const rootDomain = parts.slice(-2).join('.')
    chrome.cookies.getAll({}, (allCookies) => {
      const cookies = allCookies.filter(c => c.domain.includes(rootDomain))
      get().port?.postMessage({
        type: 'SIMULATE',
        url,
        cookies,
        ruleIds: selectedRuleIds.length > 0 ? selectedRuleIds : undefined,
      })
    })
  },

  reset: () => {
    get().port?.postMessage({ type: 'RESET' })
  },

  _applyState: (s: SwState) => {
    set({
      status: s.status,
      error: s.error,
      url: s.url,
      analyzeResult: s.analyzeResult as AnalyzeResult | null,
      simulateResult: s.simulateResult as SimulateResult | null,
      progress: s.progress ?? null,
    })
  },
}))
