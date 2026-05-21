import puppeteer from 'puppeteer'
import { buildInjectionScript } from './script-injector.js'

/**
 * SimulationEngine — replays a page load with optimization scripts pre-injected
 * via Puppeteer's evaluateOnNewDocument(), then measures performance.
 */
export class SimulationEngine {
  /**
   * @param {string} url - page to simulate
   * @param {Array} rules - rule results from RuleEngine.run() (with .script)
   * @param {Array} cookies - optional cookies to inject
   * @returns {Promise<object>} - performance metrics after simulation
   */
  async simulate({ url, rules, cookies = [] }) {
    const injectionScript = buildInjectionScript(rules)

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
      const page = await browser.newPage()
      await page.setBypassCSP(true)

      if (cookies.length > 0) {
        await page.setCookie(...cookies)
      }

      // Inject optimization scripts before any page JS runs
      await page.evaluateOnNewDocument(injectionScript)

      // Collect performance timing via CDP
      const client = await page.createCDPSession()
      await client.send('Network.enable')
      await client.send('Performance.enable')

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

      const perfMetrics = await client.send('Performance.getMetrics')
      const metricsMap = Object.fromEntries(
        perfMetrics.metrics.map(m => [m.name, m.value])
      )

      // Use Navigation Timing for LCP approximation
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        const paint = performance.getEntriesByType('paint')
        const fcp = paint.find(p => p.name === 'first-contentful-paint')
        return {
          domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
          load: nav?.loadEventEnd ?? 0,
          fcp: fcp?.startTime ?? 0,
        }
      })

      return {
        lcp: timing.load,
        fcp: timing.fcp,
        tbt: metricsMap.TaskDuration ? Math.round(metricsMap.TaskDuration * 1000) : 0,
        tti: timing.domContentLoaded,
      }
    } finally {
      await browser.close()
    }
  }
}
