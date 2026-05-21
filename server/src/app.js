import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { findSerialChains } from './chain-analyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp({ sessionManager, recordingEngine, lighthouseRunner, ruleEngine, simulationEngine } = {}) {
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

  app.use(express.json())

  // Ensure tmp/sessions dir exists
  const sessionsDir = path.join(__dirname, '..', 'tmp', 'sessions')
  fs.mkdirSync(sessionsDir, { recursive: true })

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  // SSE progress endpoint
  app.get('/api/simulate/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 15000)

    req.on('close', () => {
      clearInterval(heartbeat)
    })
  })

  // POST /api/analyze — record page, run Lighthouse, apply rules
  app.post('/api/analyze', async (req, res) => {
    const { url, cookies = [] } = req.body ?? {}

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

      // Phase 2: Lighthouse baseline
      const metrics = await lighthouseRunner.measure(url)

      // Phase 3: Find serial chains
      const chains = findSerialChains(recording.requests ?? [])

      // Phase 4: Apply rules
      const rules = await ruleEngine.run({ recording, chains }, metrics)

      res.json({
        sessionId: session.sessionId,
        url,
        metrics,
        chains,
        rules,
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
    const { url, cookies = [], rules: clientRules } = req.body ?? {}

    if (!url) {
      return res.status(400).json({ error: 'url is required' })
    }

    if (!sessionManager.acquireLock()) {
      return res.status(423).json({ error: 'A simulation is already running' })
    }

    const session = sessionManager.createSession()

    try {
      // Baseline: record + lighthouse before optimization
      const recording = await recordingEngine.record({ url, cookies, sessionDir: session.dir })
      const before = await lighthouseRunner.measure(url)
      const chains = findSerialChains(recording.requests ?? [])

      // Determine rules to apply (from client or by running engine)
      const rules = clientRules ?? await ruleEngine.run({ recording, chains }, before)

      // Simulate: inject scripts and measure
      const after = await simulationEngine.simulate({ url, rules, cookies })

      const savedMs = before.lcp != null && after.lcp != null
        ? Math.max(0, before.lcp - after.lcp)
        : rules.reduce((sum, r) => sum + (r.savedMs ?? 0), 0)

      res.json({
        sessionId: session.sessionId,
        url,
        before,
        after,
        savedMs,
        rules,
        loginRedirect: recording.loginRedirect,
      })
    } catch (err) {
      console.error('[/api/simulate]', err)
      res.status(500).json({ error: err.message })
    } finally {
      sessionManager.cleanup(session.sessionId)
    }
  })

  return app
}
