import puppeteer from 'puppeteer'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { closeBrowser } from './browser-utils.js'

const MAX_RESPONSE_BODY_BYTES = 500 * 1024 // 500KB

// --- Pure utility functions (testable without Puppeteer) ---

export function buildCacheKey(url, method, body = '') {
  const normalized = normalizeUrl(url)
  const bodyHash = crypto.createHash('md5').update(body).digest('hex')
  return `${method.toUpperCase()}:${normalized}:${bodyHash}`
}

export function shouldCacheResponse(responseBodySize) {
  return responseBodySize <= MAX_RESPONSE_BODY_BYTES
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url)
    // Remove common dynamic params
    const dynamicParams = ['t', 'ts', 'timestamp', '_t', 'rand', 'random', 'nonce', '_']
    dynamicParams.forEach(p => u.searchParams.delete(p))
    return u.toString()
  } catch {
    return url
  }
}

// --- RecordingEngine (requires Puppeteer) ---

export class RecordingEngine {
  #sessionDir
  #requests = []

  constructor(sessionDir) {
    this.#sessionDir = sessionDir
  }

  async record({ url, cookies = [] }) {
    this.#requests = []  // reset per-call — instance is reused across analyze+simulate
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
      const page = await browser.newPage()
      await page.setBypassCSP(true)

      // Cookie 注入必须在 page 处于目标域之后才能正确写入浏览器 Cookie jar。
      // page.setCookie() 和 CDP Network.setCookie(page-level) 在 about:blank 时写的是
      // session 虚拟 store，实际请求不会携带。
      // 解决方案：先导航一次到目标域根路径（忽略结果），建立 origin context，
      // 再 setCookie，然后才做真正的录制导航。
      if (cookies.length > 0) {
        const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' }
        const origin = new URL(url).origin
        // 静默导航到根路径，忽略超时/重定向，只是为了让 page 处于目标域
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
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
        await page.setCookie(...puppeteerCookies)
        console.log(`[RecordingEngine] Injecting ${cookies.length} cookies via page.setCookie (after origin nav)`)
      }

      // Enable CDP network interception
      const client = await page.createCDPSession()
      await client.send('Network.enable')

      const pendingRequests = new Map()

      client.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
        pendingRequests.set(requestId, {
          url: request.url,
          method: request.method,
          requestBody: request.postData ?? '',
          startTime: timestamp * 1000,
          source: 'network',
        })
      })

      client.on('Network.responseReceived', ({ requestId, response, timestamp }) => {
        const req = pendingRequests.get(requestId)
        if (!req) return
        req.endTime = timestamp * 1000
        req.status = response.status
        req.responseHeaders = response.headers
        req.fromServiceWorker = response.fromServiceWorker ?? false
        req.source = req.fromServiceWorker ? 'sw-cache' : 'network'
      })

      client.on('Network.loadingFinished', async ({ requestId, encodedDataLength }) => {
        const req = pendingRequests.get(requestId)
        if (!req) return

        req.responseBodySize = encodedDataLength
        req.cacheKey = buildCacheKey(req.url, req.method, req.requestBody)
        req.shouldCache = req.source === 'network' && shouldCacheResponse(encodedDataLength)

        if (req.shouldCache) {
          try {
            const { body } = await client.send('Network.getResponseBody', { requestId })
            req.responseBody = body
          } catch {
            req.responseBody = ''
            req.shouldCache = false
          }
        }

        this.#requests.push({ ...req })
        pendingRequests.delete(requestId)
      })

      // Detect login redirect:
      // Compare final URL to the intended URL. If the path changed significantly
      // (e.g. landed on a completely different path), it's likely a login redirect.
      // We do NOT use keyword matching ("login", "signin") because many apps have
      // "login" in their own URL structure (e.g. /hdb/login/home is the app shell).
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

      const finalUrl = page.url()
      const intendedPath = (() => { try { return new URL(url).pathname } catch { return '' } })()
      const finalPath = (() => { try { return new URL(finalUrl).pathname } catch { return '' } })()
      const pathChanged = intendedPath && finalPath && !finalPath.startsWith(intendedPath.split('/').slice(0, 3).join('/'))
      const hasLoginKeyword = /\/(login|signin|sign-in|auth|sso|logout)\b/i.test(finalPath) &&
        !/\/(login|signin|sign-in|auth|sso|logout)\b/i.test(intendedPath)
      const loginRedirect = pathChanged && hasLoginKeyword
      console.log(`[RecordingEngine] Final URL: ${finalUrl}`)
      console.log(`[RecordingEngine] loginRedirect: ${loginRedirect}`)

      // Debug: take screenshot to verify what Puppeteer actually rendered
      await page.screenshot({ path: 'D:/perfsim/server/tmp/debug-screenshot.png', fullPage: false })
      console.log('[RecordingEngine] Screenshot saved to tmp/debug-screenshot.png')

      // Write recording to disk
      const recordingPath = path.join(this.#sessionDir, 'recording.json')
      const recording = {
        url,
        recordedAt: Date.now(),
        loginRedirect,
        requests: this.#requests,
      }
      fs.writeFileSync(recordingPath, JSON.stringify(recording, null, 2))

      return recording
    } finally {
      await closeBrowser(browser)
    }
  }
}
