import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createApp } from '../src/app.js'
import { RuleRegistry } from '../src/rule-registry.js'

const TEST_CUSTOM_DIR = path.join(os.tmpdir(), 'perfsim-test-custom-rules-' + Date.now())

const VALID_RULE_SOURCE = `
export const id = 'my-custom-rule'
export const name = '自定义规则'
export const description = '测试用自定义规则'
export const confidence = 'medium'
export function analyze() { return { severity: 'info', affectsLCP: false, chains: [], summary: 'ok' } }
export function calculateTheoretical() { return { savedMs: 0 } }
export function buildScript() { return ';(function(){})();' }
`

const INVALID_RULE_SOURCE = `
export const id = 'incomplete-rule'
export function analyze() { return {} }
// missing calculateTheoretical and buildScript
`

function makeApp(customDir) {
  const registry = new RuleRegistry()
  return {
    app: createApp({ ruleRegistry: registry, customRulesDir: customDir }),
    registry,
  }
}

describe('POST /api/rules/import', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_CUSTOM_DIR, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(TEST_CUSTOM_DIR, { recursive: true, force: true })
  })

  it('returns 400 when no source is provided', async () => {
    const { app } = makeApp(TEST_CUSTOM_DIR)
    const res = await request(app)
      .post('/api/rules/import')
      .set('Content-Type', 'text/plain')
      .send('')
    expect(res.status).toBe(400)
  })

  it('returns 400 when rule source is missing required contract methods', async () => {
    const { app } = makeApp(TEST_CUSTOM_DIR)
    const res = await request(app)
      .post('/api/rules/import')
      .set('Content-Type', 'text/plain')
      .send(INVALID_RULE_SOURCE)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/missing|契约|method/i)
  })

  it('returns 200 and saves a valid rule to customRulesDir', async () => {
    const { app } = makeApp(TEST_CUSTOM_DIR)
    const res = await request(app)
      .post('/api/rules/import')
      .set('Content-Type', 'text/plain')
      .send(VALID_RULE_SOURCE)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('my-custom-rule')

    const files = fs.readdirSync(TEST_CUSTOM_DIR)
    expect(files.some(f => f.includes('my-custom-rule'))).toBe(true)
  })

  it('makes the imported rule available via GET /api/rules', async () => {
    const { app } = makeApp(TEST_CUSTOM_DIR)
    await request(app)
      .post('/api/rules/import')
      .set('Content-Type', 'text/plain')
      .send(VALID_RULE_SOURCE)

    const res = await request(app).get('/api/rules')
    expect(res.status).toBe(200)
    const ids = res.body.map(r => r.id)
    expect(ids).toContain('my-custom-rule')
  })

  it('returns 400 when rule source has no export id', async () => {
    const { app } = makeApp(TEST_CUSTOM_DIR)
    const noId = VALID_RULE_SOURCE.replace("export const id = 'my-custom-rule'", '')
    const res = await request(app)
      .post('/api/rules/import')
      .set('Content-Type', 'text/plain')
      .send(noId)
    expect(res.status).toBe(400)
  })
})
