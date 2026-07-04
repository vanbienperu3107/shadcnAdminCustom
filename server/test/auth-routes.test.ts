import { describe, it, expect, beforeAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

// Smoke test cho việc đăng ký route + rate-limit + validation, KHÔNG chạm DB.
// Chỉ test các nhánh trả lỗi trước khi truy vấn DB (400 validation, 401 no cookie,
// 429 rate limit) — đủ để bắt lỗi wiring plugin mà không cần Postgres.

async function buildApp(): Promise<FastifyInstance> {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db'
  const { authRoutes } = await import('../src/routes/auth.js')
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret-at-least-32-characters-long' })
  await app.register(rateLimit, { global: false })
  await app.register(authRoutes)
  await app.ready()
  return app
}

describe('auth routes wiring', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await buildApp()
  })

  it('login từ chối body sai (400) trước khi chạm DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid_request' })
  })

  it('verify-2fa không có cookie -> 401 no_pending_session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login/verify-2fa',
      payload: { code: '123456' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'no_pending_session' })
  })

  it('rate limit login: request thứ 11 trong 1 phút -> 429', async () => {
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: '' }, // 400, nhưng vẫn tính vào rate limit
      })
      codes.push(res.statusCode)
    }
    // max=10/phút -> ít nhất 1 request cuối bị chặn 429.
    expect(codes).toContain(429)
  })
})
