import { describe, it, expect } from 'vitest'
import { extractMetrics, pickMedian } from '../src/lighthouse-runner.js'

describe('extractMetrics()', () => {
  it('extracts LCP, FCP, TBT, TTI from lighthouse result', () => {
    const lhResult = {
      audits: {
        'largest-contentful-paint': { numericValue: 2500 },
        'first-contentful-paint': { numericValue: 1200 },
        'total-blocking-time': { numericValue: 300 },
        'interactive': { numericValue: 3500 },
      },
    }
    const metrics = extractMetrics(lhResult)
    expect(metrics.lcp).toBe(2500)
    expect(metrics.fcp).toBe(1200)
    expect(metrics.tbt).toBe(300)
    expect(metrics.tti).toBe(3500)
  })

  it('returns null for missing audits', () => {
    const metrics = extractMetrics({ audits: {} })
    expect(metrics.lcp).toBeNull()
    expect(metrics.fcp).toBeNull()
  })
})

describe('pickMedian()', () => {
  it('returns the median run from 3 runs by LCP', () => {
    const runs = [
      { lcp: 3000, fcp: 1000, tbt: 100, tti: 4000 },
      { lcp: 2000, fcp: 900, tbt: 80, tti: 3000 },
      { lcp: 4000, fcp: 1200, tbt: 200, tti: 5000 },
    ]
    const median = pickMedian(runs)
    expect(median.lcp).toBe(3000)
  })

  it('handles a single run', () => {
    const runs = [{ lcp: 2500, fcp: 1000, tbt: 100, tti: 3000 }]
    expect(pickMedian(runs).lcp).toBe(2500)
  })

  it('handles even number of runs by picking lower median index', () => {
    const runs = [
      { lcp: 1000, fcp: 500, tbt: 50, tti: 2000 },
      { lcp: 3000, fcp: 1500, tbt: 150, tti: 4000 },
    ]
    const median = pickMedian(runs)
    expect(median.lcp).toBe(1000)
  })
})
