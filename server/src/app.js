import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { findSerialChains } from './chain-analyzer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp({ sessionManager, recordingEngine, lighthouseRunner, ruleEngine } = {}) {
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

  return app
}
