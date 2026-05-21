import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const AUDIT_MAP = {
  lcp: 'largest-contentful-paint',
  fcp: 'first-contentful-paint',
  tbt: 'total-blocking-time',
  tti: 'interactive',
}

/**
 * Extract relevant performance metrics from a Lighthouse result object.
 * @param {object} lhResult - Lighthouse result with audits property
 * @returns {{ lcp, fcp, tbt, tti }} - metrics in milliseconds, null if missing
 */
export function extractMetrics(lhResult) {
  const audits = lhResult?.audits ?? {}
  return Object.fromEntries(
    Object.entries(AUDIT_MAP).map(([key, auditId]) => [
      key,
      audits[auditId]?.numericValue ?? null,
    ])
  )
}

/**
 * Pick the median run from an array of metric objects, sorted by LCP.
 * @param {Array<object>} runs - array of metric objects
 * @returns {object} - the median run
 */
export function pickMedian(runs) {
  if (runs.length === 0) return null
  const sorted = [...runs].sort((a, b) => a.lcp - b.lcp)
  const midIndex = Math.floor((sorted.length - 1) / 2)
  return sorted[midIndex]
}

/**
 * Run Lighthouse against a URL on the given CDP port.
 * Runs 3 times and returns the median metrics.
 *
 * @param {string} url
 * @param {number} cdpPort - Chrome Debugging Protocol port
 * @returns {Promise<object>} - median metrics
 */
export class LighthouseRunner {
  #runs

  constructor({ runs = 3 } = {}) {
    this.#runs = runs
  }

  async measure(url, cdpPort) {
    const results = []

    for (let i = 0; i < this.#runs; i++) {
      const lhResult = await this.#runOnce(url, cdpPort)
      results.push(extractMetrics(lhResult))
    }

    return pickMedian(results)
  }

  async #runOnce(url, cdpPort) {
    const { stdout } = await execFileAsync('node', [
      'node_modules/.bin/lighthouse',
      url,
      `--port=${cdpPort}`,
      '--output=json',
      '--output-path=stdout',
      '--chrome-flags=--headless',
      '--only-categories=performance',
      '--quiet',
    ])
    return JSON.parse(stdout)
  }
}
