/**
 * RuleEngine — runs all registered rules against recording + lighthouse data
 * in parallel and aggregates results.
 */
export class RuleEngine {
  #rules

  constructor(rules) {
    this.#rules = rules
  }

  /**
   * Run all rules and return aggregated results.
   * Rules that throw are skipped (logged to console.warn).
   *
   * @param {object} recordingData - output from RecordingEngine.record()
   * @param {object} lighthouseData - median metrics from LighthouseRunner.measure()
   * @returns {Promise<Array>} - array of rule results
   */
  async run(recordingData, lighthouseData) {
    const settled = await Promise.allSettled(
      this.#rules.map(rule => this.#runOne(rule, recordingData, lighthouseData))
    )

    return settled
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
  }

  async #runOne(rule, recordingData, lighthouseData) {
    try {
      const analysisResult = rule.analyze(recordingData, lighthouseData)
      const theoretical = rule.calculateTheoretical(analysisResult, lighthouseData)
      const script = rule.buildScript(analysisResult, recordingData)
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: analysisResult.severity,
        affectsLCP: analysisResult.affectsLCP,
        chains: analysisResult.chains,
        summary: analysisResult.summary,
        savedMs: theoretical.savedMs,
        script,
      }
    } catch (err) {
      console.warn(`[RuleEngine] Rule ${rule.id} failed:`, err.message)
      return null
    }
  }
}
