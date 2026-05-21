import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer'

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

  async measure(url) {
    const results = []

    for (let i = 0; i < this.#runs; i++) {
      const lhResult = await this.#runOnce(url)
      results.push(extractMetrics(lhResult))
    }

    return pickMedian(results)
  }

  async #runOnce(url) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    try {
      const { port } = new URL(browser.wsEndpoint())
      const result = await lighthouse(url, {
        port: Number(port),
        output: 'json',
        onlyCategories: ['performance'],
        logLevel: 'silent',
      })
      return result.lhr
    } finally {
      await browser.close()
    }
  }
}
