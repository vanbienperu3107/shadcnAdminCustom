import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { latencySamples } from '../db/schema.js'
import { env } from '../env.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'

type MetricsSample = {
  dst?: unknown
  dst_ip?: unknown
  rtt_ms?: unknown
  path?: unknown
  ok?: unknown
}

type MetricsBody = {
  hostname?: unknown
  ipv4?: unknown
  mac?: unknown
  samples?: unknown
}

/** Public — không cần auth. Nhận báo cáo từ metrics-report.ps1 trên các client. */
export async function headscalePublicRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/metrics/report', async (req, reply) => {
    const secret = env.METRICS_SHARED_SECRET
    if (secret && req.headers['x-metrics-secret'] !== secret) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const body = req.body as MetricsBody
    const srcHostname = String(body.hostname ?? '').toLowerCase().trim()
    if (!srcHostname || !Array.isArray(body.samples)) {
      return reply.code(400).send({ error: 'hostname and samples[] required' })
    }

    const rows = (body.samples as MetricsSample[])
      .filter((s) => s.dst)
      .map((s) => ({
        srcHostname,
        dstHostname: String(s.dst ?? '').toLowerCase().trim(),
        srcIp: body.ipv4 != null ? String(body.ipv4) : null,
        mac: body.mac != null ? String(body.mac) : null,
        rttMs: typeof s.rtt_ms === 'number' ? s.rtt_ms : null,
        path: s.path != null ? String(s.path) : null,
        ok: s.ok !== false,
        reportedAt: new Date(),
      }))
      .filter((r) => r.dstHostname)

    if (rows.length === 0) return { ok: true, upserted: 0 }

    await db
      .insert(latencySamples)
      .values(rows)
      .onConflictDoUpdate({
        target: [latencySamples.srcHostname, latencySamples.dstHostname],
        set: {
          srcIp:      sql`EXCLUDED.src_ip`,
          mac:        sql`EXCLUDED.mac`,
          rttMs:      sql`EXCLUDED.rtt_ms`,
          path:       sql`EXCLUDED.path`,
          ok:         sql`EXCLUDED.ok`,
          reportedAt: sql`EXCLUDED.reported_at`,
        },
      })

    return { ok: true, upserted: rows.length }
  })
}

/** Protected — requireAuth. Proxy headscale API + latency từ Neon DB. */
export async function headscaleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/machines', async (_req, reply) => {
    if (!(await isHsConfigured())) return { configured: false, nodes: [] }
    try {
      const d = await hsApi<{ nodes?: unknown[] }>('/api/v1/node')
      return { configured: true, nodes: d.nodes ?? [] }
    } catch (e) {
      return reply.code(502).send({ configured: true, error: String(e), nodes: [] })
    }
  })

  app.get('/api/users', async (_req, reply) => {
    if (!(await isHsConfigured())) return { configured: false, users: [] }
    try {
      const d = await hsApi<{ users?: unknown[] }>('/api/v1/user')
      return { configured: true, users: d.users ?? [] }
    } catch (e) {
      return reply.code(502).send({ configured: true, error: String(e), users: [] })
    }
  })

  /** Latency từ Neon DB (Feature L). Format pairs tương thích với hs-api.ts fetchLatency(). */
  app.get('/api/latency', async (_req, reply) => {
    try {
      const rows = await db.select().from(latencySamples)
      const pairs = rows.map((r) => ({
        src:         r.srcHostname,
        dst:         r.dstHostname,
        src_ip:      r.srcIp,
        mac:         r.mac,
        rtt_ms:      r.rttMs,
        avg_ms:      r.rttMs,       // backward compat — frontend dùng avg_ms
        path:        r.path,
        last_path:   r.path,        // backward compat — frontend dùng last_path
        ok:          r.ok,
        reported_at: r.reportedAt,
      }))
      return { pairs }
    } catch (e) {
      return reply.code(502).send({ error: String(e), pairs: [] })
    }
  })
}
