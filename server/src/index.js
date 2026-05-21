import { createApp } from './app.js'

const PORT = process.env.PORT || 3000
const app = createApp()

app.listen(PORT, () => {
  console.log(`PerfSim Server running at http://localhost:${PORT}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})
