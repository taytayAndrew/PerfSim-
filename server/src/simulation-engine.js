import puppeteer from 'puppeteer'
import lighthouse from 'lighthouse'
import { buildInjectionScript } from './script-injector.js'
import { extractMetrics, pickMedian } from './lighthouse-runner.js'
import { closeBrowser } from './browser-utils.js'

const RUNS = 3

/**
 * SimulationEngine — injects rule scripts via evaluateOnNewDocument, then measures with Lighthouse.
 *
 * Rule scripts intercept fetch/XHR and return cached responses instantly,
 * simulating parallelization of serial chains. This approach does NOT trigger
 * extra network requests, so Lighthouse reaches networkidle normally.
 */
export class SimulationEngine {
  async simulate({ url, rules, cookies = [] }) {
    const injectionScript = buildInjectionScript(rules)
    console.log(`[SimulationEngine] injection script: ${injectionScript.length} chars, rules=${rules.length}`)
    const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' }
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

    const results = []
    for (let i = 0; i < RUNS; i++) {
      try {
        const metrics = await this.#runOnce({ url, injectionScript, puppeteerCookies, runIndex: i + 1 })
        console.log(`[SimulationEngine] run ${i + 1}/${RUNS} done, LCP=${Math.round(metrics.lcp ?? -1)}ms`)
        results.push(metrics)
      } catch (err) {
        console.warn(`[SimulationEngine] run ${i + 1}/${RUNS} failed: ${err.message}`)
        results.push({ lcp: null, fcp: null, tbt: null, tti: null })
      }
    }

    return pickMedian(results)
  }

  async #runOnce({ url, injectionScript, puppeteerCookies, runIndex }) {
    const t0 = Date.now()
    const tick = (label) => console.log(`[SimulationEngine] run ${runIndex}/${RUNS} — ${label} (+${Date.now() - t0}ms)`)

    tick('starting')
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    tick('browser launched')

    try {
      // Inject cookies into the real browser-level cookie store via page.setCookie().
      // page.setCookie() writes to the browser-level store shared by ALL tabs,
      // including Lighthouse's internal tab. We must navigate to the target origin
      // first to establish an origin context — otherwise setCookie has no domain to
      // bind to. CDP Network.setCookie (page-level) writes to a virtual store that
      // Chrome ignores when sending real requests.
      if (puppeteerCookies.length > 0) {
        const tempPage = await browser.newPage()
        const origin = new URL(url).origin
        await tempPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
        await tempPage.setCookie(...puppeteerCookies)
        await tempPage.close()
        tick(`${puppeteerCookies.length} cookies set via page.setCookie (after origin nav)`)
      }

      const page = await browser.newPage()
      await page.setBypassCSP(true)
      tick('page created')

      // Inject the rule script before page navigation.
      // Scripts intercept fetch/XHR and return cached responses — no new network
      // requests are triggered, so Lighthouse reaches networkidle normally.
      await page.evaluateOnNewDocument(injectionScript)
      tick('injection script registered')

      // Capture [perfsim] logs from the injection script running inside the page
      page.on('console', msg => {
        const text = msg.text()
        if (text.startsWith('[perfsim]')) {
          tick(`PAGE: ${text}`)
        }
      })

      await page.goto('about:blank')
      tick('navigated to about:blank')

      const { port } = new URL(browser.wsEndpoint())
      tick(`calling lighthouse on port ${port}`)
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
        // 'provided' = trust actual observed timing (not Lantern simulation).
        // Our fetch/XHR intercept returns cached responses instantly, so the
        // real page load time drops. Lantern ('simulate') ignores actual timing
        // and re-models from raw network traces — making our interception invisible.
        throttlingMethod: 'provided',
        throttling: {
          rttMs: 0,
          throughputKbps: 0,
          cpuSlowdownMultiplier: 1,
          requestLatencyMs: 0,
          downloadThroughputKbps: 0,
          uploadThroughputKbps: 0,
        },
      }, undefined, page)

      tick('lighthouse done')
      return extractMetrics(result.lhr)
    } finally {
      await closeBrowser(browser)
    }
  }
}
