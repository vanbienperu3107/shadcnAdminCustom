import { describe, it, expect, beforeAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// Unit cho reducer parseShareStatusRow (thuần, không DB) + smoke wiring cho
// route ingest (validation 400 trước khi chạm DB). Không cần Postgres.

async function loadModule() {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db'
  return import('../src/routes/folder-shares.js')
}

describe('parseShareStatusRow', () => {
  it('payload hợp lệ → tách shares/mounts', async () => {
    const { parseShareStatusRow } = await loadModule()
    const out = parseShareStatusRow({
      mac: 'dc:4a',
      hostname: 'ITOP',
      payload: JSON.stringify({
        shares: [{ name: 'tool', path: 'E:\\Tool', ok: true }],
        mounts: [{ share: 'tool', drive: 'Z:', ok: false, error: 'System error 67' }],
      }),
      reportedAt: null,
    })
    expect(out.mac).toBe('dc:4a')
    expect(out.shares).toHaveLength(1)
    expect(out.mounts).toHaveLength(1)
    expect((out.mounts[0] as { error: string }).error).toBe('System error 67')
  })

  it('payload null → shares/mounts rỗng', async () => {
    const { parseShareStatusRow } = await loadModule()
    const out = parseShareStatusRow({ mac: 'x', hostname: null, payload: null, reportedAt: null })
    expect(out.shares).toEqual([])
    expect(out.mounts).toEqual([])
  })

  it('payload hỏng (không phải JSON) → rỗng, không ném', async () => {
    const { parseShareStatusRow } = await loadModule()
    const out = parseShareStatusRow({ mac: 'x', hostname: null, payload: '{bad json', reportedAt: null })
    expect(out.shares).toEqual([])
    expect(out.mounts).toEqual([])
  })

  it('shares không phải mảng → bỏ qua, giữ rỗng', async () => {
    const { parseShareStatusRow } = await loadModule()
    const out = parseShareStatusRow({
      mac: 'x',
      hostname: null,
      payload: JSON.stringify({ shares: 'nope', mounts: null }),
      reportedAt: null,
    })
    expect(out.shares).toEqual([])
    expect(out.mounts).toEqual([])
  })
})

describe('foldershare-status ingest route wiring', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    // Không set HEADSCALE_DASHBOARD_SECRET → checkSecret pass → tới validation.
    const { folderSharesPublicRoutes } = await loadModule()
    app = Fastify()
    await app.register(folderSharesPublicRoutes)
    await app.ready()
  })

  it('body thiếu mac → 400 (trước khi chạm DB)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/foldershare-status',
      payload: { shares: [], mounts: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('shares sai kiểu (thiếu ok) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal/foldershare-status',
      payload: { mac: 'dc:4a', shares: [{ name: 'tool' }], mounts: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})
