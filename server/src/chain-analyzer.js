// Gap threshold: max time between A ending and B starting to be considered serial.
// Covers JSON.parse + Promise microtask + business logic (~20-80ms typical),
// with 2x safety margin. Filters out user interactions (>200ms) and timers (>500ms).
const SERIAL_GAP_MS = 150

/**
 * Find serial request chains from recording data.
 * A serial chain is a sequence of requests where each starts after the previous ends,
 * indicating the code waited for the previous response before issuing the next request.
 *
 * @param {Array} requests - Array of request objects with startTime, endTime, url, cacheKey
 * @returns {Array<Array>} - Array of chains, each chain is an array of requests
 */
export function findSerialChains(requests) {
  if (requests.length === 0) return []
  // Exclude non-network resources (data URIs, blob URLs).
  // Also exclude requests with missing timing — loadingFailed paths never set endTime,
  // and undefined arithmetic (undefined + 150 = NaN) silently breaks chain comparisons.
  const networkRequests = requests.filter(r =>
    r.url && !r.url.startsWith('data:') && !r.url.startsWith('blob:') &&
    r.startTime != null && r.endTime != null
  )

  const sorted = [...networkRequests].sort((a, b) => a.startTime - b.startTime)
  const chains = []
  const used = new Set()

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue

    const chain = [sorted[i]]
    used.add(i)

    let current = sorted[i]
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue
      const next = sorted[j]
      // B must start after A ends, within SERIAL_GAP_MS — causal serial dependency
      if (next.startTime >= current.endTime && next.startTime <= current.endTime + SERIAL_GAP_MS) {
        chain.push(next)
        used.add(j)
        current = next
      }
    }

    if (chain.length >= 2) {
      chains.push(chain)
    }
  }

  console.log(`[ChainAnalyzer] input=${requests.length} requests → ${chains.length} chains`)
  return chains
}
