import { describe, it, expect } from 'vitest'
import { analyze, calculateTheoretical, buildScript } from '../../rules/serial-chain-preload.js'

const makeChain = (requests) => requests
const makeRequest = (url, startTime, endTime, method = 'GET') => ({
  url, method, startTime, endTime,
  cacheKey: `${method}:${url}:hash`,
  source: 'network',
  status: 200,
})

describe('serial-chain-preload rule', () => {
  describe('analyze()', () => {
    it('returns severity info when no chains', () => {
      const result = analyze({ chains: [] })
      expect(result.severity).toBe('info')
      expect(result.chains).toHaveLength(0)
    })

    it('returns severity high when long chains exist', () => {
      const chain = [
        makeRequest('https://example.com/a.js', 0, 100),
        makeRequest('https://example.com/b.js', 110, 300),
        makeRequest('https://example.com/c.js', 310, 500),
      ]
      const result = analyze({ chains: [chain] })
      expect(result.severity).toBe('high')
      expect(result.affectsLCP).toBe(true)
    })

    it('includes chain length and total delay in result', () => {
      const chain = [
        makeRequest('https://example.com/a.js', 0, 100),
        makeRequest('https://example.com/b.js', 110, 300),
      ]
      const result = analyze({ chains: [chain] })
      expect(result.chains).toHaveLength(1)
      expect(result.chains[0].totalDelayMs).toBeGreaterThan(0)
    })

    it('only includes chains with length >= 2', () => {
      const result = analyze({ chains: [[makeRequest('https://example.com/a.js', 0, 100)]] })
      expect(result.chains).toHaveLength(0)
    })
  })

  describe('calculateTheoretical()', () => {
    it('returns savedMs equal to sum of delays after first request', () => {
      const analysisResult = {
        chains: [{
          requests: [
            makeRequest('https://example.com/a.js', 0, 100),
            makeRequest('https://example.com/b.js', 110, 300),
            makeRequest('https://example.com/c.js', 310, 500),
          ],
          totalDelayMs: 410,
        }]
      }
      const { savedMs } = calculateTheoretical(analysisResult, {})
      expect(savedMs).toBeGreaterThan(0)
    })

    it('returns 0 savedMs when no chains', () => {
      const { savedMs } = calculateTheoretical({ chains: [] }, {})
      expect(savedMs).toBe(0)
    })
  })

  describe('buildScript()', () => {
    it('returns a string containing preload logic', () => {
      const analysisResult = {
        chains: [{
          requests: [
            makeRequest('https://example.com/a.js', 0, 100),
            makeRequest('https://example.com/b.js', 110, 300),
          ],
          totalDelayMs: 200,
        }]
      }
      const script = buildScript(analysisResult, {})
      expect(typeof script).toBe('string')
      expect(script).toContain('preload')
      expect(script).toContain('https://example.com/b.js')
    })

    it('returns empty IIFE when no chains', () => {
      const script = buildScript({ chains: [] }, {})
      expect(typeof script).toBe('string')
      expect(script.length).toBeGreaterThan(0)
    })
  })
})
