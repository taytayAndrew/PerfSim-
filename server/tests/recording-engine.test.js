import { describe, it, expect } from 'vitest'
import { buildCacheKey, shouldCacheResponse, normalizeUrl } from '../src/recording-engine.js'

describe('buildCacheKey()', () => {
  it('returns consistent key for same URL + method + body', () => {
    const key1 = buildCacheKey('https://api.example.com/data', 'POST', '{"id":1}')
    const key2 = buildCacheKey('https://api.example.com/data', 'POST', '{"id":1}')
    expect(key1).toBe(key2)
  })

  it('returns different keys for different bodies', () => {
    const key1 = buildCacheKey('https://api.example.com/data', 'POST', '{"id":1}')
    const key2 = buildCacheKey('https://api.example.com/data', 'POST', '{"id":2}')
    expect(key1).not.toBe(key2)
  })

  it('returns different keys for different methods', () => {
    const key1 = buildCacheKey('https://api.example.com/data', 'GET', '')
    const key2 = buildCacheKey('https://api.example.com/data', 'POST', '')
    expect(key1).not.toBe(key2)
  })
})

describe('shouldCacheResponse()', () => {
  it('returns true for responses under 500KB', () => {
    expect(shouldCacheResponse(100 * 1024)).toBe(true)
  })

  it('returns false for responses over 500KB', () => {
    expect(shouldCacheResponse(600 * 1024)).toBe(false)
  })

  it('returns true at exactly 500KB', () => {
    expect(shouldCacheResponse(500 * 1024)).toBe(true)
  })
})

describe('normalizeUrl()', () => {
  it('removes common dynamic params like t, ts, timestamp', () => {
    const url = 'https://api.example.com/data?id=1&t=1234567890&ts=abc'
    const normalized = normalizeUrl(url)
    expect(normalized).not.toContain('t=')
    expect(normalized).toContain('id=1')
  })

  it('returns same URL if no dynamic params present', () => {
    const url = 'https://api.example.com/data?id=1'
    expect(normalizeUrl(url)).toContain('id=1')
  })

  it('returns original string for invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url')
  })
})
