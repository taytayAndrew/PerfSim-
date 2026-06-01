import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { SessionManager } from '../src/session-manager.js'
import path from 'path'
import os from 'os'

const TEST_TMP = path.join(os.tmpdir(), 'perfsim-test-simulate-' + Date.now())

function makeMockEngines() {
  return {
    recordingEngine: {
      record: async () => ({
        url: 'https://example.com',
        recordedAt: Date.now(),
        loginRedirect: false,
        requests: [],
      }),
    },
    lighthouseRunner: {
      measure: async () => ({ lcp: 2500, fcp: 1000, tbt: 100, tti: 3000 }),
    },
    ruleEngine: {
      run: async () => ([
        { ruleId: 'serial-chain', severity: 'high', affectsLCP: true, chains: [{ requests: [{url:'https://example.com/api', startTime:0, endTime:100},{url:'https://example.com/api2', startTime:110, endTime:200}] }], summary: 'ok', savedMs: 300, script: 'console.log("optimized")' },
      ]),
    },
    simulationEngine: {
      simulate: async () => ({ lcp: 1800, fcp: 800, tbt: 60, tti: 2200 }),
    },
  }
}

describe('POST /api/simulate', () => {
  let app
  let sessionManager

  beforeEach(() => {
    sessionManager = new SessionManager(TEST_TMP)
    app = createApp({ sessionManager, ...makeMockEngines() })
  })

  it('returns 400 if url is missing', async () => {
    const res = await request(app).post('/api/simulate').send({})
    expect(res.status).toBe(400)
  })

  it('returns 200 with before/after metrics', async () => {
    const res = await request(app).post('/api/simulate').send({ url: 'https://example.com' })
    expect(res.status).toBe(200)
    expect(res.body.before).toBeDefined()
    expect(res.body.after).toBeDefined()
    expect(res.body.before.lcp).toBe(2500)
    expect(res.body.after.lcp).toBe(1800)
  })

  it('returns 423 when a simulation is already running', async () => {
    sessionManager.acquireLock()
    const res = await request(app).post('/api/simulate').send({ url: 'https://example.com' })
    expect(res.status).toBe(423)
  })

  it('includes savedMs total in response', async () => {
    const res = await request(app).post('/api/simulate').send({ url: 'https://example.com' })
    expect(typeof res.body.savedMs).toBe('number')
  })

  it('includes rules used in the simulation', async () => {
    const res = await request(app).post('/api/simulate').send({ url: 'https://example.com' })
    expect(Array.isArray(res.body.rules)).toBe(true)
    expect(res.body.rules[0].ruleId).toBe('serial-chain')
  })

  it('passes ruleIds to ruleEngine.run() when provided', async () => {
    let capturedRuleIds = 'NOT_SET'
    const engines = makeMockEngines()
    engines.ruleEngine = {
      run: async (_data, _metrics, ruleIds) => {
        capturedRuleIds = ruleIds
        return [{ ruleId: 'serial-chain', severity: 'high', affectsLCP: true, chains: [{ requests: [{url:'https://example.com/api',startTime:0,endTime:100},{url:'https://example.com/api2',startTime:110,endTime:200}] }], summary: 'ok', savedMs: 300, script: '' }]
      }
    }
    const localApp = createApp({ sessionManager: new SessionManager(TEST_TMP), ...engines })
    await request(localApp).post('/api/simulate').send({ url: 'https://example.com', ruleIds: ['rule-serial-chain'] })
    expect(capturedRuleIds).toEqual(['rule-serial-chain'])
  })
})
