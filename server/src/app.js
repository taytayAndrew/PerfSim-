import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import fs from 'fs'
import { findSerialChains } from './chain-analyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Strip large/internal fields before sending to client
function sanitizeRequest(req) {
  const { responseBody, requestBody, responseHeaders, ...rest } = req
  return rest
}

function sanitizeChains(chains) {
  return chains.map(chain => chain.map(sanitizeRequest))
}

// Sanitize rule results — strip responseBody/headers from nested request objects
function sanitizeRules(rules) {
  return rules.map(rule => ({
    ...rule,
    findings: Array.isArray(rule.findings)
      ? rule.findings.map(finding => {
          // Finding is a plain array of requests (e.g. serial chain or dedup group)
          if (Array.isArray(finding)) {
            return finding.map(sanitizeRequest)
          }
          // Finding is an object with a requests array (future rule shapes)
          if (finding && Array.isArray(finding.requests)) {
            return { ...finding, requests: finding.requests.map(sanitizeRequest) }
          }
          return finding
        })
      : rule.findings,
    // cards are already sanitized (only contain url, label, ms, highlight — no responseBody)
    cards: rule.cards ?? [],
  }))
}

export function createApp({ sessionManager, recordingEngine, lighthouseRunner, ruleEngine, simulationEngine, ruleRegistry, customRulesDir } = {}) {
  const app = express()

  // CORS — allow Chrome Extension sources
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || origin.startsWith('chrome-extension://')) {
        callback(null, true)
      } else {
        callback(null, true) // allow all in dev; tighten in prod
      }
    }
  }))

  app.use(express.json({ limit: '10mb' }))

  // Ensure tmp/sessions dir exists
  const sessionsDir = path.join(__dirname, '..', 'tmp', 'sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // GET /api/rules — return registered rules (metadata only, no functions)
  app.get('/api/rules', (req, res) => {
    const rules = ruleRegistry?.getRules() ?? []
    res.json(rules.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      confidence: r.confidence,
    })))
  })

  // POST /api/rules/import — upload a custom rule as plain-text JS source
  // Client sends the raw .js file content as text/plain body.
  // Server validates the contract, saves to customRulesDir, and hot-loads into registry.
  app.post('/api/rules/import', express.text({ type: '*/*', limit: '512kb' }), async (req, res) => {
    const source = req.body
    if (!source || typeof source !== 'string' || source.trim().length === 0) {
      return res.status(400).json({ error: '规则源码不能为空' })
    }

    // Resolve custom rules directory (default: rules/custom/ next to src/)
    const targetDir = customRulesDir ?? path.join(__dirname, '..', 'rules', 'custom')
    fs.mkdirSync(targetDir, { recursive: true })

    // Write to a temp file so we can import() it for validation
    const tmpFile = path.join(targetDir, `_tmp_import_${Date.now()}.js`)
    fs.writeFileSync(tmpFile, source, 'utf-8')

    let mod
    try {
      mod = await import(pathToFileURL(tmpFile).href)
    } catch (err) {
      fs.rmSync(tmpFile, { force: true })
      return res.status(400).json({ error: `规则语法错误：${err.message}` })
    }

    // Validate contract
    const REQUIRED = ['analyze', 'calculateTheoretical', 'buildScript']
    const missing = REQUIRED.filter(m => typeof mod[m] !== 'function')
    if (missing.length > 0) {
      fs.rmSync(tmpFile, { force: true })
      return res.status(400).json({ error: `规则缺少必要方法：${missing.join(', ')}（missing contract methods）` })
    }
    if (!mod.id) {
      fs.rmSync(tmpFile, { force: true })
      return res.status(400).json({ error: '规则必须导出 id 字段' })
    }

    // Move tmp file to final location named by rule id
    const finalFile = path.join(targetDir, `${mod.id}.js`)
    fs.renameSync(tmpFile, finalFile)

    // Hot-load into registry
    if (ruleRegistry) {
      ruleRegistry.register(mod.id, {
        id: mod.id,
        name: mod.name ?? mod.id,
        description: mod.description ?? '',
        confidence: mod.confidence ?? 'medium',
        analyze: mod.analyze,
        calculateTheoretical: mod.calculateTheoretical,
        buildScript: mod.buildScript,
        buildHtml: mod.buildHtml,
      })
    }

    console.log(`[/api/rules/import] Loaded custom rule: ${mod.id} → ${finalFile}`)
    res.json({ id: mod.id, name: mod.name ?? mod.id, file: finalFile })
  })

  // POST /api/cancel — release the session lock so a new task can start
  // The in-flight Puppeteer task will finish or error on its own; this just
  // unblocks the 423 gate so the user can retry immediately.
  app.post('/api/cancel', (req, res) => {
    sessionManager.releaseLock()
    res.json({ ok: true })
  })

  // Progress emitter — keyed by progressId from POST body
  const progressMap = new Map() // progressId → SSEResponse

  function emitProgress(progressId, data) {
    const res = progressMap.get(progressId)
    if (res) res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // SSE progress endpoint — client opens this BEFORE POSTing /api/simulate
  app.get('/api/simulate/progress', (req, res) => {
    const { id } = req.query
    if (!id) return res.status(400).end()

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    progressMap.set(id, res)

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000)
    req.on('close', () => {
      clearInterval(heartbeat)
      progressMap.delete(id)
    })
  })

  // POST /api/analyze — record page, run Lighthouse, apply rules
  app.post('/api/analyze', async (req, res) => {
    const { url, cookies = [], ruleIds } = req.body ?? {}

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    if (!sessionManager.acquireLock()) {
      return res.status(423).json({ error: 'A simulation is already running' })
    }

    const session = sessionManager.createSession()

    try {
      // Phase 1: Record
      const recording = await recordingEngine.record({ url, cookies, sessionDir: session.dir })

      // Abort immediately if page redirected to login — cookies are expired/invalid.
      // Continuing would produce garbage data (recording login page HTML, not real API responses).
      if (recording.loginRedirect) {
        return res.status(401).json({ error: 'LOGIN_REDIRECT: Cookie 已失效，页面跳转到了登录页，请重新登录后再试' })
      }

      // Phase 2: Lighthouse baseline (with cookies for authenticated pages)
      const metrics = await lighthouseRunner.measure(url, cookies)

      // Phase 3: Find serial chains (raw — rules need responseBody for causal analysis)
      const chains = findSerialChains(recording.requests ?? [])

      // Phase 4: Apply rules with full chain data (includes responseBody for dependency analysis)
      const rules = await ruleEngine.run({ recording, chains }, metrics, ruleIds)

      // Sanitize only when sending to client — strip responseBody/headers
      res.json({
        sessionId: session.sessionId,
        url,
        metrics,
        chains: sanitizeChains(chains),
        rules: sanitizeRules(rules),
        loginRedirect: recording.loginRedirect,
        recordedAt: recording.recordedAt,
      })
    } catch (err) {
      console.error('[/api/analyze]', err)
      res.status(500).json({ error: err.message })
    } finally {
      sessionManager.cleanup(session.sessionId)
    }
  })

  // POST /api/simulate — inject optimization scripts, replay, return before/after metrics
  app.post('/api/simulate', async (req, res) => {
    const { url, cookies = [], rules: clientRules, baselineMetrics, progressId, ruleIds } = req.body ?? {}

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    if (!sessionManager.acquireLock()) {
      return res.status(423).json({ error: 'A simulation is already running' })
    }

    const session = sessionManager.createSession()
    const emit = (step, detail = '') => emitProgress(progressId, { step, detail })

    try {
      emit('recording', '录制页面网络请求…')
      // Baseline: record + lighthouse before optimization
      const recording = await recordingEngine.record({ url, cookies, sessionDir: session.dir })

      if (recording.loginRedirect) {
        emit('error', 'Cookie 已失效，页面跳转到了登录页')
        return res.status(401).json({ error: 'LOGIN_REDIRECT: Cookie 已失效，页面跳转到了登录页，请重新登录后再试' })
      }

      const chains = findSerialChains(recording.requests ?? [])
      const cleanChains = sanitizeChains(chains)

      emit('analyzing', '分析串行请求链…')
      // Always re-run rule engine so SimulationEngine gets rules with html/script fields.
      // clientRules (from analyze response) are serialized and lack buildHtml output.
      // Pass null metrics — rule engine uses metrics only for severity, which doesn't affect chains.
      const rules = await ruleEngine.run({ recording, chains }, null, ruleIds)

      // If no rule found any qualifying chains, there's nothing to simulate.
      // Return immediately using the baseline metrics from analyze — skip all Lighthouse runs.
      const hasOptimizableRules = rules.some(r => Array.isArray(r.findings) && r.findings.length > 0)
      if (!hasOptimizableRules) {
        emit('done', '未发现可优化的串行链')
        const before = baselineMetrics ?? { lcp: null, fcp: null, tbt: null, tti: null }
        return res.json({
          sessionId: session.sessionId,
          url,
          before,
          after: { ...before },
          savedMs: 0,
          rules: sanitizeRules(rules),
          chains: cleanChains,
          loginRedirect: recording.loginRedirect,
          noOptimization: true,
        })
      }

      emit('baseline', '测量优化前基线（Lighthouse ×3）…')
      // Has optimizable chains — measure before and simulate after
      const beforeRaw = await lighthouseRunner.measure(url, cookies)

      emit('simulating', '注入优化脚本，测量优化后指标（Lighthouse ×3）…')
      const afterRaw = await simulationEngine.simulate({ url, rules, cookies })

      const before = beforeRaw ?? { lcp: null, fcp: null, tbt: null, tti: null }
      const after = afterRaw ?? { lcp: null, fcp: null, tbt: null, tti: null }

      const savedMs = before.lcp != null && after.lcp != null
        ? Math.max(0, before.lcp - after.lcp)
        : rules.reduce((sum, r) => sum + (r.savedMs ?? 0), 0)

      emit('done', '推演完成')
      res.json({
        sessionId: session.sessionId,
        url,
        before,
        after,
        savedMs,
        rules: sanitizeRules(rules),
        chains: cleanChains,
        loginRedirect: recording.loginRedirect,
      })
    } catch (err) {
      emit('error', err.message)
      console.error('[/api/simulate]', err)
      res.status(500).json({ error: err.message })
    } finally {
      sessionManager.cleanup(session.sessionId)
    }
  })

  return app
}
