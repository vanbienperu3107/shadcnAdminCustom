import { describe, it, expect, beforeAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

// Smoke test wiring VPN routes — KHÔNG chạm DB. Chỉ các nhánh trả lỗi TRƯỚC khi
// truy vấn DB: agent 401 (thiếu token/gateway), admin 401 (thiếu cookie phiên),
// validation. Đủ bắt lỗi wiring mà không cần Postgres.

async function buildApp(): Promise<FastifyInstance> {
  process.env.DATABASE_URL ??= 'postgres://ci:ci@localhost:5432/ci'
  const { vpnAgentPublicRoutes, vpnRoutes } = await import('../src/routes/vpn.js')
  const app = Fastify()
  const ck = 'y'.repeat(40) // giá trị test giả cho cookie signer
  await app.register(cookie, { secret: ck })
  await app.register(rateLimit, { global: false })
  await app.register(vpnAgentPublicRoutes)
  await app.register(vpnRoutes)
  await app.ready()
  return app
}

describe('vpn routes wiring', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await buildApp()
  })

  it('agent/config KHÔNG có Authorization -> 401 (trước khi chạm DB)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vpn/agent/config?gateway=bitel',
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('agent/config có token nhưng thiếu ?gateway -> 401 (trước khi chạm DB)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/vpn/agent/config',
      headers: { authorization: 'Bearer sometoken' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('agent/status KHÔNG có Authorization -> 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vpn/agent/status?gateway=bitel',
      payload: { state: 'up' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('admin GET gateways KHÔNG có cookie -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vpn/gateways' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('admin POST gateway KHÔNG có cookie -> 401 (auth chặn trước validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vpn/gateways',
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('agent/config rate-limit: request thứ 61 trong 1 phút -> 429', async () => {
    const codes: number[] = []
    for (let i = 0; i < 61; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/vpn/agent/config', // 401, nhưng vẫn tính vào rate limit
      })
      codes.push(res.statusCode)
    }
    expect(codes).toContain(429)
  })
})
