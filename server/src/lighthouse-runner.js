import lighthouse from 'lighthouse'
import puppeteer from 'puppeteer'
import { closeBrowser } from './browser-utils.js'

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
  // Filter out runs where LCP is null (page failed to load — cookie expiry / NO_LCP error)
  const valid = runs.filter(r => r.lcp !== null && r.lcp !== undefined)
  console.log(`[pickMedian] ${valid.length}/${runs.length} valid runs (non-null LCP)`)
  if (valid.length === 0) {
    console.warn('[pickMedian] ALL runs returned null LCP — returning null')
    return null
  }
  const sorted = [...valid].sort((a, b) => a.lcp - b.lcp)
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

  async measure(url, cookies = []) {
    const results = []

    for (let i = 0; i < this.#runs; i++) {
      console.log(`[LighthouseRunner] run ${i + 1}/${this.#runs} starting...`)
      try {
        const lhResult = await this.#runOnce(url, cookies)
        const metrics = extractMetrics(lhResult)
        console.log(`[LighthouseRunner] run ${i + 1}/${this.#runs} done, LCP=${Math.round(metrics.lcp ?? -1)}ms`)
        results.push(metrics)
      } catch (err) {
        console.warn(`[LighthouseRunner] run ${i + 1}/${this.#runs} failed: ${err.message}`)
        // Push null-LCP entry so pickMedian can skip it
        results.push({ lcp: null, fcp: null, tbt: null, tti: null })
      }
    }

    return pickMedian(results)
  }

  async #runOnce(url, cookies = []) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    try {
      // Inject cookies via page.setCookie() after navigating to the target origin.
      // page.setCookie() writes to the browser-level cookie store shared by ALL tabs,
      // including the new tab Lighthouse opens internally.
      // CDP Network.setCookie (page-level session) writes to a virtual NetworkContext
      // that Chrome ignores when sending real requests — see BUG-06/BUG-11.
      // We must navigate to the target origin first to establish an origin context,
      // otherwise setCookie has no domain to bind to.
      if (cookies.length > 0) {
        const tempPage = await browser.newPage()
        const origin = new URL(url).origin
        const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' }
        await tempPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
        const puppeteerCookies = cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? '/',
          secure: c.secure ?? false,
          httpOnly: c.httpOnly ?? false,
          sameSite: sameSiteMap[c.sameSite] ?? 'Lax',
          ...(c.expirationDate ? { expires: c.expirationDate } : {}),
        }))
        await tempPage.setCookie(...puppeteerCookies)
        await tempPage.close()
        console.log(`[LighthouseRunner] ${cookies.length} cookies set via page.setCookie (after origin nav)`)
      }

      const { port } = new URL(browser.wsEndpoint())
      const result = await lighthouse(url, {
        port: Number(port),
        output: 'json',
        onlyCategories: ['performance'],
        logLevel: 'silent',
        maxWaitForLoad: 45000,
        maxWaitForFcp: 30000,
        formFactor: 'desktop',
        screenEmulation: {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1,
          disabled: false,
        },
        // 'provided' = trust observed timing (no Lantern re-modeling).
        // Matches SimulationEngine's mode so before/after are on equal footing.
        throttlingMethod: 'provided',
        throttling: {
          rttMs: 0,
          throughputKbps: 0,
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
        },
      })
      return result.lhr
    } finally {
      await closeBrowser(browser)
    }
  }
}
