import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const REQUIRED_METHODS = ['analyze', 'calculateTheoretical', 'buildScript']

export class RuleRegistry {
  #rules = new Map()

  async loadFromDir(dir) {
    if (!fs.existsSync(dir)) return

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'))

    for (const file of files) {
      const filePath = path.join(dir, file)
      try {
        const mod = await import(pathToFileURL(filePath).href)
        this.#validateAndRegister(mod)
      } catch (err) {
        console.warn(`[RuleRegistry] Failed to load ${file}:`, err.message)
      }
    }
  }

  #validateAndRegister(mod) {
    const missing = REQUIRED_METHODS.filter(m => typeof mod[m] !== 'function')
    if (missing.length > 0) {
      console.warn(`[RuleRegistry] Rule missing methods: ${missing.join(', ')} — skipped`)
      return
    }
    if (!mod.id) {
      console.warn('[RuleRegistry] Rule missing id — skipped')
      return
    }
    this.#rules.set(mod.id, {
      id: mod.id,
      name: mod.name ?? mod.id,
      description: mod.description ?? '',
      confidence: mod.confidence ?? 'medium',
      analyze: mod.analyze,
      calculateTheoretical: mod.calculateTheoretical,
      buildScript: mod.buildScript,
    })
  }

  register(id, rule) {
    this.#validateAndRegister({ id, ...rule })
  }

  getRules() {
    return Array.from(this.#rules.values())
  }

  getRule(id) {
    return this.#rules.get(id) ?? null
  }
}
