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

/**
 * Combines HTML snippets from all rules into a single string
 * to inject into the <head> of the HTML response.
 *
 * @param {Array<{ html?: string }>} rules
 * @returns {string} - combined HTML tags
 */
export function buildHtmlInjection(rules) {
  return rules
    .map(r => r.html)
    .filter(h => typeof h === 'string' && h.trim().length > 0)
    .join('\n')
}
