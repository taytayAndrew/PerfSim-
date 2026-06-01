import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

function makeRuleRegistry(rules = []) {
  return {
    getRules: () => rules,
    getRule: (id) => rules.find(r => r.id === id) ?? null,
  }
}

const STUB_RULE = {
  id: 'rule-serial-chain',
  name: '串行请求链并行化',
  description: '检测深度 > 2 的串行请求链',
  confidence: 'medium',
  analyze: () => {},
  calculateTheoretical: () => {},
  buildScript: () => '',
}

describe('GET /api/rules', () => {
  it('returns empty array when no rules registered', async () => {
    const app = createApp({ ruleRegistry: makeRuleRegistry([]) })
    const res = await request(app).get('/api/rules')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns rule list with id, name, description, confidence', async () => {
    const app = createApp({ ruleRegistry: makeRuleRegistry([STUB_RULE]) })
    const res = await request(app).get('/api/rules')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      id: 'rule-serial-chain',
      name: '串行请求链并行化',
      description: '检测深度 > 2 的串行请求链',
      confidence: 'medium',
    })
  })

  it('does not expose analyze/buildScript functions', async () => {
    const app = createApp({ ruleRegistry: makeRuleRegistry([STUB_RULE]) })
    const res = await request(app).get('/api/rules')
    expect(res.body[0].analyze).toBeUndefined()
    expect(res.body[0].buildScript).toBeUndefined()
  })
})
