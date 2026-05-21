import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export class SessionManager {
  #sessionsDir
  #locked = false
  #currentSessionId = null

  constructor(sessionsDir) {
    this.#sessionsDir = sessionsDir
    fs.mkdirSync(sessionsDir, { recursive: true })
  }

  createSession() {
    const sessionId = crypto.randomUUID()
    const dir = path.join(this.#sessionsDir, sessionId)
    fs.mkdirSync(dir, { recursive: true })
    this.#currentSessionId = sessionId
    return { sessionId, dir }
  }

  cleanup(sessionId) {
    const dir = path.join(this.#sessionsDir, sessionId)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    if (this.#currentSessionId === sessionId) {
      this.#currentSessionId = null
    }
    this.#locked = false
  }

  acquireLock() {
    if (this.#locked) return false
    this.#locked = true
    return true
  }

  releaseLock() {
    this.#locked = false
  }
}
