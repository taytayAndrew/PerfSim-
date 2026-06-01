import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { SessionManager } from '../src/session-manager.js'
import path from 'path'
import os from 'os'

const TEST_TMP = path.join(os.tmpdir(), 'perfsim-test-analyze-' + Date.now())

function makeMockEngines(ruleRunSpy) {
  return {
    recordingEngine: {
      record: async () => ({
        url: 'https://example.com',
        recordedAt: Date.now(),
        loginRedirect: false,
        requests: [
          { url: 'https://api.example.com/a', startTime: 0, endTime: 100, cacheKey: 'GET:a:x', source: 'network' },
          { url: 'https://api.example.com/b', startTime: 110, endTime: 200, cacheKey: 'GET:b:x', source: 'network' },
        ],
      }),
    },
    lighthouseRunner: {
      measure: async () => ({ lcp: 2500, fcp: 1000, tbt: 100, tti: 3000 }),
    },
    ruleEngine: {
      run: ruleRunSpy ?? (async () => ([
        { ruleId: 'serial-chain', severity: 'high', affectsLCP: true, chains: [], summary: 'Found 1 chain', savedMs: 300, script: '(function(){})()' },
      ])),
    },
  }
}

describe('POST /api/analyze', () => {
  let app
  let sessionManager

  beforeEach(() => {
    sessionManager = new SessionManager(TEST_TMP)
    const engines = makeMockEngines()
    app = createApp({ sessionManager, ...engines })
  })

  it('returns 400 if url is missing', async () => {
    const res = await request(app).post('/api/analyze').send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with analysis results for valid url', async () => {
    const res = await request(app).post('/api/analyze').send({ url: 'https://example.com' })
    expect(res.status).toBe(200)
    expect(res.body.metrics).toBeDefined()
    expect(res.body.rules).toHaveLength(1)
    expect(res.body.rules[0].ruleId).toBe('serial-chain')
  })

  it('returns 423 when a simulation is already running', async () => {
    sessionManager.acquireLock()
    const res = await request(app).post('/api/analyze').send({ url: 'https://example.com' })
    expect(res.status).toBe(423)
  })

  it('includes chains in analysis results', async () => {
    const res = await request(app).post('/api/analyze').send({ url: 'https://example.com' })
    expect(res.body.chains).toBeDefined()
    expect(Array.isArray(res.body.chains)).toBe(true)
  })

  it('includes loginRedirect flag in response', async () => {
    const res = await request(app).post('/api/analyze').send({ url: 'https://example.com' })
    expect(typeof res.body.loginRedirect).toBe('boolean')
  })

  it('passes ruleIds to ruleEngine.run() when provided', async () => {
    let capturedRuleIds
    const spy = async (_recordingData, _metrics, ruleIds) => {
      capturedRuleIds = ruleIds
      return []
    }
    const appWithSpy = createApp({ sessionManager: new SessionManager(TEST_TMP), ...makeMockEngines(spy) })
    await request(appWithSpy).post('/api/analyze').send({ url: 'https://example.com', ruleIds: ['rule-serial-chain'] })
    expect(capturedRuleIds).toEqual(['rule-serial-chain'])
  })

  it('passes undefined ruleIds to ruleEngine.run() when not provided (runs all)', async () => {
    let capturedRuleIds = 'NOT_SET'
    const spy = async (_recordingData, _metrics, ruleIds) => {
      capturedRuleIds = ruleIds
      return []
    }
    const appWithSpy = createApp({ sessionManager: new SessionManager(TEST_TMP), ...makeMockEngines(spy) })
    await request(appWithSpy).post('/api/analyze').send({ url: 'https://example.com' })
    expect(capturedRuleIds).toBeUndefined()
  })
})
