import { describe, it, expect } from 'vitest'
import request from 'supertest'
import http from 'http'
import { createApp } from '../src/app.js'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})

describe('GET /api/simulate/progress (SSE)', () => {
  it('responds with text/event-stream content type', async () => {
    const app = createApp()
    const server = app.listen(0)
    const port = server.address().port

    await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/api/simulate/progress`, (res) => {
        expect(res.headers['content-type']).toMatch('text/event-stream')
        req.destroy()
        server.close(resolve)
      })
      req.on('error', reject)
    })
  })
})

