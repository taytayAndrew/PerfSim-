import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
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

  return app
}
