import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { RuleRegistry } from '../src/rule-registry.js'

const TEST_RULES_DIR = path.join(process.cwd(), 'tmp', 'test-rules')

const VALID_RULE = `
export const id = 'test-rule'
export const name = '测试规则'
export const description = '用于测试的规则'
export const confidence = 'medium'
export function analyze(recordingData) { return { severity: 'info', affectsLCP: false, chains: [], summary: 'ok' } }
export function calculateTheoretical(analysisResult, lighthouseData) { return { savedMs: 0 } }
export function buildScript(analysisResult, cacheData) { return '(function(){})()' }
`

describe('RuleRegistry', () => {
  let registry

  beforeEach(() => {
    fs.mkdirSync(TEST_RULES_DIR, { recursive: true })
    registry = new RuleRegistry()
  })

  afterEach(() => {
    fs.rmSync(TEST_RULES_DIR, { recursive: true, force: true })
  })

  describe('loadFromDir()', () => {
    it('loads a valid rule and makes it available via getRules()', async () => {
      fs.writeFileSync(path.join(TEST_RULES_DIR, 'test-rule.js'), VALID_RULE)
      await registry.loadFromDir(TEST_RULES_DIR)
      const rules = registry.getRules()
      expect(rules).toHaveLength(1)
      expect(rules[0].id).toBe('test-rule')
    })

    it('skips a rule missing required methods without throwing', async () => {
      const invalidRule = `export const id = 'bad-rule'\nexport function analyze() {}`
      fs.writeFileSync(path.join(TEST_RULES_DIR, 'bad-rule.js'), invalidRule)
      await expect(registry.loadFromDir(TEST_RULES_DIR)).resolves.not.toThrow()
      expect(registry.getRules()).toHaveLength(0)
    })

    it('loads only valid rules when dir contains mixed valid and invalid', async () => {
      fs.writeFileSync(path.join(TEST_RULES_DIR, 'valid.js'), VALID_RULE)
      fs.writeFileSync(path.join(TEST_RULES_DIR, 'invalid.js'), `export const id = 'bad'`)
      await registry.loadFromDir(TEST_RULES_DIR)
      expect(registry.getRules()).toHaveLength(1)
      expect(registry.getRules()[0].id).toBe('test-rule')
    })
  })

  describe('getRule(id)', () => {
    it('returns the rule by id after loading', async () => {
      fs.writeFileSync(path.join(TEST_RULES_DIR, 'test-rule.js'), VALID_RULE)
      await registry.loadFromDir(TEST_RULES_DIR)
      const rule = registry.getRule('test-rule')
      expect(rule).not.toBeNull()
      expect(rule.id).toBe('test-rule')
      expect(typeof rule.analyze).toBe('function')
    })

    it('returns null for unknown id', () => {
      expect(registry.getRule('does-not-exist')).toBeNull()
    })
  })
})
