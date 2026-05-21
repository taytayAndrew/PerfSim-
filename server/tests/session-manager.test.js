import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { SessionManager } from '../src/session-manager.js'

const TEST_TMP = path.join(process.cwd(), 'tmp', 'test-sessions')

describe('SessionManager', () => {
  let manager

  beforeEach(() => {
    manager = new SessionManager(TEST_TMP)
  })

  afterEach(() => {
    if (fs.existsSync(TEST_TMP)) {
      fs.rmSync(TEST_TMP, { recursive: true, force: true })
    }
  })

  describe('createSession()', () => {
    it('returns a unique sessionId and creates the session directory', () => {
      const session = manager.createSession()
      expect(session.sessionId).toBeTruthy()
      expect(typeof session.sessionId).toBe('string')
      expect(fs.existsSync(session.dir)).toBe(true)
    })

    it('generates different sessionIds on each call', () => {
      const a = manager.createSession()
      const b = manager.createSession()
      expect(a.sessionId).not.toBe(b.sessionId)
    })
  })

  describe('acquireLock() / releaseLock()', () => {
    it('first acquireLock returns true', () => {
      expect(manager.acquireLock()).toBe(true)
    })

    it('second acquireLock returns false when lock is held', () => {
      manager.acquireLock()
      expect(manager.acquireLock()).toBe(false)
    })

    it('acquireLock returns true again after releaseLock', () => {
      manager.acquireLock()
      manager.releaseLock()
      expect(manager.acquireLock()).toBe(true)
    })
  })

  describe('cleanup(sessionId)', () => {
    it('deletes the session directory', () => {
      const session = manager.createSession()
      expect(fs.existsSync(session.dir)).toBe(true)
      manager.cleanup(session.sessionId)
      expect(fs.existsSync(session.dir)).toBe(false)
    })

    it('releases the lock after cleanup', () => {
      const session = manager.createSession()
      manager.acquireLock()
      manager.cleanup(session.sessionId)
      expect(manager.acquireLock()).toBe(true)
    })

    it('does not throw if session dir does not exist', () => {
      expect(() => manager.cleanup('nonexistent-id')).not.toThrow()
    })
  })
})
