export const id = 'serial-chain-preload'
export const name = 'Serial Chain Preload'
export const description =
  'Detects serial request chains and injects <link rel="preload"> for downstream resources to eliminate cascading round-trips.'
export const confidence = 'high'

const MIN_CHAIN_LENGTH = 2
const HIGH_SEVERITY_DELAY_MS = 200

/**
 * @param {{ chains: Array<Array> }} recordingData
 */
export function analyze({ chains = [] }) {
  const qualifiedChains = chains
    .filter(chain => chain.length >= MIN_CHAIN_LENGTH)
    .map(chain => {
      // Total delay = time from end of first request to end of last request
      // This is what we can potentially save by preloading
      const first = chain[0]
      const last = chain[chain.length - 1]
      const totalDelayMs = last.endTime - first.endTime
      return { requests: chain, totalDelayMs }
    })

  const maxDelay = qualifiedChains.reduce((max, c) => Math.max(max, c.totalDelayMs), 0)
  const severity = maxDelay >= HIGH_SEVERITY_DELAY_MS ? 'high' : qualifiedChains.length > 0 ? 'medium' : 'info'

  return {
    severity,
    affectsLCP: severity === 'high',
    chains: qualifiedChains,
    summary: qualifiedChains.length > 0
      ? `Found ${qualifiedChains.length} serial chain(s), max delay ${Math.round(maxDelay)}ms`
      : 'No serial chains detected',
  }
}

/**
 * @param {{ chains: Array }} analysisResult
 */
export function calculateTheoretical(analysisResult) {
  const savedMs = analysisResult.chains.reduce((sum, c) => {
    // We can save everything after the first request ends
    const first = c.requests[0]
    const last = c.requests[c.requests.length - 1]
    return sum + Math.max(0, last.endTime - first.endTime)
  }, 0)

  return { savedMs: Math.round(savedMs) }
}

/**
 * Build an injection script that preloads downstream chain resources
 * via document.head link elements before the page JS runs.
 *
 * @param {{ chains: Array }} analysisResult
 */
export function buildScript(analysisResult) {
  const { chains } = analysisResult

  if (!chains || chains.length === 0) {
    return ';(function(){})();'
  }

  // Collect all URLs that are NOT the first in their chain (i.e. can be preloaded)
  const preloadUrls = []
  for (const chain of chains) {
    for (let i = 1; i < chain.requests.length; i++) {
      const req = chain.requests[i]
      if (req.url && !req.url.startsWith('data:') && !preloadUrls.includes(req.url)) {
        preloadUrls.push(req.url)
      }
    }
  }

  const preloadLines = preloadUrls.map(url => {
    const as = guessAs(url)
    return `  var l = document.createElement('link');
  l.rel = 'preload';
  l.href = ${JSON.stringify(url)};
  l.as = '${as}';
  l.crossOrigin = 'anonymous';
  document.head.appendChild(l);`
  }).join('\n')

  return `;(function(){
  if (document.readyState === 'loading') {
${preloadLines}
  }
})();`
}

function guessAs(url) {
  if (/\.js(\?|$)/.test(url)) return 'script'
  if (/\.css(\?|$)/.test(url)) return 'style'
  if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(url)) return 'font'
  if (/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/.test(url)) return 'image'
  return 'fetch'
}
