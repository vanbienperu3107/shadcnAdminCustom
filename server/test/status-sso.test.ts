import { describe, it, expect, beforeAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

// /api/auth/forward: nhánh trước khi chạm DB (không cookie -> 401). Nhánh có
// phiên hợp lệ cần Postgres nên kiểm ở bước verify sau deploy.

async function buildApp(ssoEmail: string): Promise<FastifyInstance> {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db'
  process.env.BESZEL_SSO_EMAIL = ssoEmail
  const { vi } = await import('vitest')
  vi.resetModules()
  const { authRoutes } = await import('../src/routes/auth.js')
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret-at-least-32-characters-long' })
  await app.register(rateLimit, { global: false })
  await app.register(authRoutes)
  await app.ready()
  return app
}

describe('GET /api/auth/forward', () => {
  describe('SSO bật', () => {
    let app: FastifyInstance
    beforeAll(async () => {
      app = await buildApp('admin@hangocthanh.io.vn')
    })

    it('không có cookie -> 401 và không có X-Auth-Email', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/forward' })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers['x-auth-email']).toBeUndefined()
    })

    it('X-Auth-Email do client tự gửi không làm route trả 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/forward',
        headers: { 'x-auth-email': 'attacker@example.com' },
      })
      expect(res.statusCode).toBe(401)
      expect(res.headers['x-auth-email']).toBeUndefined()
    })
  })

  describe('SSO tắt (BESZEL_SSO_EMAIL trống)', () => {
    let app: FastifyInstance
    beforeAll(async () => {
      app = await buildApp('')
    })

    it('-> 404 sso_disabled', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/forward' })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'sso_disabled' })
      expect(res.headers['x-auth-email']).toBeUndefined()
    })
  })
})
