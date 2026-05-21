/**
 * Combines multiple rule scripts into a single self-contained IIFE
 * suitable for use with Puppeteer's evaluateOnNewDocument().
 *
 * @param {Array<{ script: string }>} rules - rule results with script strings
 * @returns {string} - combined injection script
 */
export function buildInjectionScript(rules) {
  const parts = rules
    .map(r => r.script)
    .filter(s => typeof s === 'string' && s.trim().length > 0)

  const body = parts.join('\n')
  return `;(function(){\n${body}\n})();`
}
