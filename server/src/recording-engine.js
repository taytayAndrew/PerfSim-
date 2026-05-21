import puppeteer from 'puppeteer'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

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
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    try {
      const page = await browser.newPage()
      await page.setBypassCSP(true)

      // Inject cookies
      if (cookies.length > 0) {
        await page.setCookie(...cookies)
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

      // Detect login redirect
      let loginRedirect = false
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          const nav = frame.url()
          if (nav.includes('login') || nav.includes('signin') || nav.includes('auth')) {
            loginRedirect = true
          }
        }
      })

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

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
      await browser.close()
    }
  }
}
