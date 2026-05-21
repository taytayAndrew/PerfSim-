import path from 'path'
import { fileURLToPath } from 'url'
import { createApp } from './app.js'
import { SessionManager } from './session-manager.js'
import { RecordingEngine } from './recording-engine.js'
import { LighthouseRunner } from './lighthouse-runner.js'
import { RuleRegistry } from './rule-registry.js'
import { RuleEngine } from './rule-engine.js'
import { SimulationEngine } from './simulation-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = process.env.PORT || 3000
const sessionsDir = path.join(__dirname, '..', 'tmp', 'sessions')
const rulesDir = path.join(__dirname, '..', 'rules')

// Wire up engines
const sessionManager = new SessionManager(sessionsDir)

const recordingEngine = new RecordingEngine(sessionsDir)

const lighthouseRunner = new LighthouseRunner({ runs: 3 })

const registry = new RuleRegistry()
await registry.loadFromDir(rulesDir)
const ruleEngine = new RuleEngine(registry.getRules())

const simulationEngine = new SimulationEngine()

const app = createApp({
  sessionManager,
  recordingEngine,
  lighthouseRunner,
  ruleEngine,
  simulationEngine,
})

app.listen(PORT, () => {
  console.log(`PerfSim Server running at http://localhost:${PORT}`)
  console.log(`Health:    GET  http://localhost:${PORT}/health`)
  console.log(`Analyze:   POST http://localhost:${PORT}/api/analyze`)
  console.log(`Simulate:  POST http://localhost:${PORT}/api/simulate`)
  console.log(`Rules loaded: ${registry.getRules().length}`)
})
