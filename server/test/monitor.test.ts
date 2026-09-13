import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db'

const RECORD = {
  id: 'abc',
  name: 'vpn6',
  status: 'up',
  updated: '2026-09-13 17:55:00.000Z',
  info: { cpu: 15.2, mp: 37.1, dp: 55.9, la: [0.57, 0.45, 0.38], b: 0.0116, bb: 12186, u: 9849600, v: '0.19.0' },
}

describe('mapSystem', () => {
  it('chuẩn hóa record đầy đủ', async () => {
    const { mapSystem } = await import('../src/lib/beszel.js')
    expect(mapSystem(RECORD)).toEqual({
      id: 'abc',
      name: 'vpn6',
      status: 'up',
      cpu: 15.2,
      mem: 37.1,
      disk: 55.9,
      load: [0.57, 0.45, 0.38],
      netBps: 12186,
      uptimeSec: 9849600,
      agent: '0.19.0',
      updated: '2026-09-13 17:55:00.000Z',
    })
  })

  it('thiếu bb -> đổi b (MB/s) sang byte/s', async () => {
    const { mapSystem } = await import('../src/lib/beszel.js')
    const s = mapSystem({ id: 'x', name: 'vpn4', status: 'up', info: { b: 2 } })
    expect(s.netBps).toBe(2 * 1024 * 1024)
  })

  it('info rỗng / status lạ -> null + pending, không bịa số 0', async () => {
    const { mapSystem } = await import('../src/lib/beszel.js')
    const s = mapSystem({ id: 'x', name: 'new', status: 'weird' })
    expect(s.status).toBe('pending')
    expect(s.cpu).toBeNull()
    expect(s.mem).toBeNull()
    expect(s.disk).toBeNull()
    expect(s.load).toBeNull()
    expect(s.netBps).toBeNull()
    expect(s.agent).toBeNull()
  })

  it('load avg sai độ dài -> null', async () => {
    const { mapSystem } = await import('../src/lib/beszel.js')
    const s = mapSystem({ id: 'x', name: 'a', status: 'down', info: { la: [1, 2] as never } })
    expect(s.load).toBeNull()
    expect(s.status).toBe('down')
  })
})

async function buildApp(envs: Record<string, string>): Promise<FastifyInstance> {
  for (const [k, v] of Object.entries(envs)) process.env[k] = v
  vi.resetModules()
  const { monitorRoutes } = await import('../src/routes/monitor.js')
  const { resetBeszelToken } = await import('../src/lib/beszel.js')
  resetBeszelToken()
  const app = Fastify()
  await app.register(cookie, { secret: 'test-secret-at-least-32-characters-long' })
  await app.register(monitorRoutes)
  await app.ready()
  return app
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/monitor/systems', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('không có phiên -> 401, không gọi Beszel', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const app = await buildApp({ AUTH_OPTIONAL: 'false', BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: 'x' })
    const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
    expect(res.statusCode).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  describe('đã đăng nhập (AUTH_OPTIONAL=true -> DEV_USER)', () => {
    beforeEach(() => {
      process.env.AUTH_OPTIONAL = 'true'
    })
    afterEach(() => {
      process.env.AUTH_OPTIONAL = 'false'
    })

    it('chưa cấu hình mật khẩu -> 503 monitor_not_configured', async () => {
      const app = await buildApp({ BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: '' })
      const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: 'monitor_not_configured' })
    })

    it('đăng nhập superuser rồi trả danh sách đã chuẩn hóa', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(json(200, { token: 'T1' }))
        .mockResolvedValueOnce(json(200, { items: [RECORD] }))
      vi.stubGlobal('fetch', fetchSpy)
      const app = await buildApp({ BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: 'pw', BESZEL_URL: 'http://beszel:8090' })
      const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
      expect(res.statusCode).toBe(200)
      expect(res.json().systems[0]).toMatchObject({ name: 'vpn6', cpu: 15.2, status: 'up' })
      expect(fetchSpy.mock.calls[0][0]).toBe('http://beszel:8090/api/collections/_superusers/auth-with-password')
      expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ identity: 'a@b.c', password: 'pw' })
      expect(fetchSpy.mock.calls[1][1].headers).toEqual({ Authorization: 'T1' })
    })

    it('token hết hạn (401) -> đăng nhập lại đúng 1 lần rồi thành công', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(json(200, { token: 'OLD' }))
        .mockResolvedValueOnce(json(401, {}))
        .mockResolvedValueOnce(json(200, { token: 'NEW' }))
        .mockResolvedValueOnce(json(200, { items: [RECORD] }))
      vi.stubGlobal('fetch', fetchSpy)
      const app = await buildApp({ BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: 'pw' })
      const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
      expect(res.statusCode).toBe(200)
      expect(fetchSpy).toHaveBeenCalledTimes(4)
      expect(fetchSpy.mock.calls[3][1].headers).toEqual({ Authorization: 'NEW' })
    })

    it('sai mật khẩu Beszel -> 502 beszel_unreachable kèm lý do', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(400, {})))
      const app = await buildApp({ BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: 'wrong' })
      const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
      expect(res.statusCode).toBe(502)
      expect(res.json()).toEqual({ error: 'beszel_unreachable', message: 'beszel login HTTP 400' })
    })

    it('Beszel không phản hồi (lỗi mạng) -> 502', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('connect ECONNREFUSED')))
      const app = await buildApp({ BESZEL_EMAIL: 'a@b.c', BESZEL_PASSWORD: 'pw' })
      const res = await app.inject({ method: 'GET', url: '/api/monitor/systems' })
      expect(res.statusCode).toBe(502)
      expect(res.json().message).toBe('connect ECONNREFUSED')
    })
  })
})
