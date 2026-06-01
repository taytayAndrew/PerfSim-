import { describe, it, expect } from 'vitest'
import { RuleEngine } from '../src/rule-engine.js'

const makeRule = (id, result) => ({
  id,
  name: id,
  analyze: () => result,
  calculateTheoretical: (analysisResult) => ({ savedMs: analysisResult.savedMs ?? 0 }),
  buildScript: () => `(function(){/* ${id} */})()`,
})

describe('RuleEngine', () => {
  describe('run()', () => {
    it('returns empty array when no rules registered', async () => {
      const engine = new RuleEngine([])
      const results = await engine.run({}, {})
      expect(results).toEqual([])
    })

    it('returns analysis result from a single rule', async () => {
      const rule = makeRule('rule-a', { severity: 'high', affectsLCP: true, chains: [], summary: 'bad', savedMs: 200 })
      const engine = new RuleEngine([rule])
      const results = await engine.run({}, {})
      expect(results).toHaveLength(1)
      expect(results[0].ruleId).toBe('rule-a')
      expect(results[0].severity).toBe('high')
      expect(results[0].savedMs).toBe(200)
    })

    it('runs multiple rules and returns all results', async () => {
      const rules = [
        makeRule('rule-a', { severity: 'high', affectsLCP: true, chains: [], summary: 'bad', savedMs: 200 }),
        makeRule('rule-b', { severity: 'low', affectsLCP: false, chains: [], summary: 'ok', savedMs: 50 }),
      ]
      const engine = new RuleEngine(rules)
      const results = await engine.run({}, {})
      expect(results).toHaveLength(2)
      const ids = results.map(r => r.ruleId)
      expect(ids).toContain('rule-a')
      expect(ids).toContain('rule-b')
    })

    it('skips a rule that throws and includes the rest', async () => {
      const badRule = {
        id: 'bad-rule',
        name: 'bad',
        analyze: () => { throw new Error('analysis failed') },
        calculateTheoretical: () => ({ savedMs: 0 }),
        buildScript: () => '',
      }
      const goodRule = makeRule('good-rule', { severity: 'info', affectsLCP: false, chains: [], summary: 'ok', savedMs: 0 })
      const engine = new RuleEngine([badRule, goodRule])
      const results = await engine.run({}, {})
      expect(results).toHaveLength(1)
      expect(results[0].ruleId).toBe('good-rule')
    })

    it('only runs rules matching ruleIds when provided', async () => {
      const rules = [
        makeRule('rule-a', { severity: 'high', affectsLCP: true, chains: [], summary: 'a', savedMs: 100 }),
        makeRule('rule-b', { severity: 'info', affectsLCP: false, chains: [], summary: 'b', savedMs: 0 }),
      ]
      const engine = new RuleEngine(rules)
      const results = await engine.run({}, {}, ['rule-a'])
      expect(results).toHaveLength(1)
      expect(results[0].ruleId).toBe('rule-a')
    })

    it('runs all rules when ruleIds is undefined', async () => {
      const rules = [
        makeRule('rule-a', { severity: 'high', affectsLCP: true, chains: [], summary: 'a', savedMs: 100 }),
        makeRule('rule-b', { severity: 'info', affectsLCP: false, chains: [], summary: 'b', savedMs: 0 }),
      ]
      const engine = new RuleEngine(rules)
      const results = await engine.run({}, {}, undefined)
      expect(results).toHaveLength(2)
    })

    it('returns empty array when ruleIds matches no registered rules', async () => {
      const rule = makeRule('rule-a', { severity: 'info', affectsLCP: false, chains: [], summary: 'ok', savedMs: 0 })
      const engine = new RuleEngine([rule])
      const results = await engine.run({}, {}, ['rule-does-not-exist'])
      expect(results).toHaveLength(0)
    })
  })
})
