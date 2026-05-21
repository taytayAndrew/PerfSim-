import { describe, it, expect } from 'vitest'
import { buildInjectionScript } from '../src/script-injector.js'

describe('buildInjectionScript()', () => {
  it('returns empty IIFE for no rules', () => {
    const script = buildInjectionScript([])
    expect(typeof script).toBe('string')
    expect(script.length).toBeGreaterThan(0)
  })

  it('wraps a single rule script in an IIFE', () => {
    const rules = [{ script: 'console.log("a")' }]
    const script = buildInjectionScript(rules)
    expect(script).toContain('console.log("a")')
  })

  it('combines multiple rule scripts', () => {
    const rules = [
      { script: 'console.log("a")' },
      { script: 'console.log("b")' },
    ]
    const script = buildInjectionScript(rules)
    expect(script).toContain('console.log("a")')
    expect(script).toContain('console.log("b")')
  })

  it('skips rules with empty or missing script', () => {
    const rules = [
      { script: '' },
      { script: 'console.log("ok")' },
      {},
    ]
    const script = buildInjectionScript(rules)
    expect(script).toContain('console.log("ok")')
  })

  it('wraps everything in a self-contained IIFE', () => {
    const rules = [{ script: 'var x = 1' }]
    const script = buildInjectionScript(rules)
    // Must start with ( or ; to avoid global leaks
    expect(script.trim()).toMatch(/^[;(]/)
  })
})
