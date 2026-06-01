/**
 * ContentScript — injected into the target page.
 *
 * Responsibilities (PRD #15):
 * 1. Keep Background SW alive via chrome.runtime.connect() Port
 *    (MV3 SW is killed after ~30s of inactivity — Port connection prevents that)
 * 2. Connect to SSE /api/simulate/progress and forward progress to SW
 * 3. Inject overlay + progress bar while simulation is running
 * 4. Remove overlay when done or failed
 * 5. Detect login redirect and notify SW
 */

// ── 1. Keep-alive Port ────────────────────────────────────────────
// A persistent Port from content script → SW prevents Chrome from
// killing the SW during long-running fetch operations.
let port: chrome.runtime.Port | null = null

function connectPort() {
  port = chrome.runtime.connect({ name: 'content-script' })
  port.onDisconnect.addListener(() => {
    port = null
    // SW was restarted — reconnect after a short delay
    setTimeout(connectPort, 1000)
  })
  port.onMessage.addListener((msg: { type: string; status?: string }) => {
    if (msg.type === 'STATE') {
      handleStateChange(msg.status ?? 'idle')
    }
  })
}

connectPort()

// ── 3 & 4. Overlay ───────────────────────────────────────────────
let overlay: HTMLElement | null = null

function showOverlay() {
  if (overlay) return
  overlay = document.createElement('div')
  overlay.id = '__perfsim_overlay__'
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:rgba(0,0,0,0.55)', 'display:flex',
    'flex-direction:column', 'align-items:center', 'justify-content:center',
    'font-family:system-ui,sans-serif', 'color:#fff',
  ].join(';')

  const msg = document.createElement('div')
  msg.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:8px'
  msg.textContent = '推演中，请勿操作…'

  const sub = document.createElement('div')
  sub.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6)'
  sub.textContent = '预计耗时 3–5 分钟'

  overlay.appendChild(msg)
  overlay.appendChild(sub)
  document.body.appendChild(overlay)
}

function removeOverlay() {
  overlay?.remove()
  overlay = null
}

// ── 5. State handler ─────────────────────────────────────────────
function handleStateChange(status: string) {
  if (status === 'simulating') {
    isActive = true
    showOverlay()
  } else if (status === 'analyzing') {
    isActive = true
  } else if (status === 'done' || status === 'error' || status === 'idle') {
    isActive = false
    removeOverlay()
  }
}

// ── 6. Login redirect detection ──────────────────────────────────
// Only fire during active analyze/simulate — avoid false positives from SPA navigation
let isActive = false

function checkLoginRedirect() {
  if (!isActive) return
  const current = location.href
  const lower = current.toLowerCase()
  if (lower.includes('login') || lower.includes('signin') || lower.includes('sso_login')) {
    port?.postMessage({ type: 'LOGIN_REDIRECT', url: current })
  }
}

// Poll for SPA navigation (pushState / replaceState don't fire popstate)
setInterval(checkLoginRedirect, 2000)
