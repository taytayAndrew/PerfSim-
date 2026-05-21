// Gap threshold: requests starting within this ms of a previous response end
// are considered causally dependent (serial chain)
const SERIAL_GAP_MS = 50

/**
 * Find serial request chains from recording data.
 * A serial chain is a sequence of requests where each starts after the previous ends
 * (within SERIAL_GAP_MS tolerance), indicating causal dependency.
 *
 * @param {Array} requests - Array of request objects with startTime, endTime, url, cacheKey
 * @returns {Array<Array>} - Array of chains, each chain is an array of requests
 */
export function findSerialChains(requests) {
  if (requests.length === 0) return []

  const sorted = [...requests].sort((a, b) => a.startTime - b.startTime)
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
      // next must start after current ends (serial, not parallel)
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

  return chains
}
