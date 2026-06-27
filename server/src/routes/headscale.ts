import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { latencySamples } from '../db/schema.js'
import { env } from '../env.js'
import { hsApi, isHsConfigured, isHsNotFound } from '../lib/headscale.js'

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

  // ── Routes ──────────────────────────────────────────────────────────────────

  // headscale 0.26+ bỏ /api/v1/routes; subnet routes nằm trong node
  // (approvedRoutes / availableRoutes / subnetRoutes). Dựng danh sách route từ node.
  type HsNode = {
    id?: string
    name?: string
    givenName?: string
    user?: unknown
    online?: boolean
    approvedRoutes?: string[]
    availableRoutes?: string[]
    subnetRoutes?: string[]
  }

  app.get('/api/routes', async (_req, reply) => {
    if (!(await isHsConfigured())) return { configured: false, routes: [] }
    try {
      const d = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
      const routes = (d.nodes ?? []).flatMap((n) => {
        const approved = n.approvedRoutes ?? []
        const available = n.availableRoutes ?? []
        const subnet = n.subnetRoutes ?? []
        const prefixes = Array.from(new Set([...available, ...approved]))
        return prefixes.map((prefix) => ({
          id: `${n.id}|${prefix}`,
          prefix,
          enabled: approved.includes(prefix),
          isPrimary: subnet.includes(prefix),
          node: { id: n.id, name: n.name, givenName: n.givenName, user: n.user, online: n.online },
        }))
      })
      return { configured: true, routes }
    } catch (e) {
      if (isHsNotFound(e)) return { configured: true, routes: [] }
      return reply.code(502).send({ configured: true, error: String(e), routes: [] })
    }
  })

  // Tách "<nodeId>|<prefix>" rồi set lại approvedRoutes (add khi enable, remove khi delete).
  function parseRouteId(raw: string): { nodeId: string; prefix: string } | null {
    const id = decodeURIComponent(raw)
    const sep = id.indexOf('|')
    if (sep < 0) return null
    return { nodeId: id.slice(0, sep), prefix: id.slice(sep + 1) }
  }
  async function setApproved(nodeId: string, mutate: (s: Set<string>) => void): Promise<void> {
    const d = await hsApi<{ node?: HsNode }>(`/api/v1/node/${encodeURIComponent(nodeId)}`)
    const set = new Set(d.node?.approvedRoutes ?? [])
    mutate(set)
    await hsApi(`/api/v1/node/${encodeURIComponent(nodeId)}/approve_routes`, {
      method: 'POST',
      body: JSON.stringify({ routes: [...set] }),
    })
  }

  app.post('/api/routes/:id/enable', async (req, reply) => {
    if (!(await isHsConfigured())) return reply.code(503).send({ error: 'not configured' })
    const p = parseRouteId((req.params as { id: string }).id)
    if (!p) return reply.code(400).send({ error: 'bad route id' })
    try {
      await setApproved(p.nodeId, (s) => s.add(p.prefix))
      return { ok: true }
    } catch (e) {
      return reply.code(isHsNotFound(e) ? 404 : 502).send({ error: String(e) })
    }
  })

  app.delete('/api/routes/:id', async (req, reply) => {
    if (!(await isHsConfigured())) return reply.code(503).send({ error: 'not configured' })
    const p = parseRouteId((req.params as { id: string }).id)
    if (!p) return reply.code(400).send({ error: 'bad route id' })
    try {
      await setApproved(p.nodeId, (s) => s.delete(p.prefix))
      return reply.code(204).send()
    } catch (e) {
      return reply.code(isHsNotFound(e) ? 404 : 502).send({ error: String(e) })
    }
  })

  // ── ACL Policy ───────────────────────────────────────────────────────────────

  app.get('/api/acl', async (_req, reply) => {
    if (!(await isHsConfigured())) return { configured: false, policy: '' }
    try {
      const d = await hsApi<{ policy?: string }>('/api/v1/policy')
      return { configured: true, policy: d.policy ?? '' }
    } catch (e) {
      if (isHsNotFound(e)) return { configured: true, policy: '' }
      return reply.code(502).send({ configured: true, error: String(e), policy: '' })
    }
  })

  app.post('/api/acl', async (req, reply) => {
    if (!(await isHsConfigured())) return reply.code(503).send({ error: 'not configured' })
    const { policy } = req.body as { policy?: string }
    if (typeof policy !== 'string') return reply.code(400).send({ error: 'policy string required' })
    try {
      await hsApi('/api/v1/policy', { method: 'PUT', body: JSON.stringify({ policy }) })
      return { ok: true }
    } catch (e) {
      return reply.code(isHsNotFound(e) ? 404 : 502).send({ error: String(e) })
    }
  })

  // ── Pre-auth Keys ────────────────────────────────────────────────────────────
  //
  // headscale's /api/v1/preauthkey expects a numeric user ID (uint64), not a
  // username. resolveUserNumericID translates a display name → numeric ID via
  // GET /api/v1/user?name=<name>, then the actual preauthkey calls use that ID.

  async function resolveUserNumericID(name: string): Promise<string> {
    const d = await hsApi<{ users?: { id?: string; name?: string }[] }>(
      `/api/v1/user?name=${encodeURIComponent(name)}`,
    )
    const id = d.users?.[0]?.id
    if (!id) throw Object.assign(new Error(`user not found: ${name}`), { status: 404 })
    return id
  }

  app.get('/api/users/:user/preauthkeys', async (req, reply) => {
    if (!(await isHsConfigured())) return { configured: false, preAuthKeys: [] }
    const { user } = req.params as { user: string }
    try {
      const uid = await resolveUserNumericID(user)
      const d = await hsApi<{ preAuthKeys?: unknown[] }>(
        `/api/v1/preauthkey?user=${encodeURIComponent(uid)}`,
      )
      return { configured: true, preAuthKeys: d.preAuthKeys ?? [] }
    } catch (e) {
      if (isHsNotFound(e)) return { configured: true, preAuthKeys: [] }
      return reply.code(502).send({ configured: true, error: String(e), preAuthKeys: [] })
    }
  })

  app.post('/api/preauthkeys', async (req, reply) => {
    if (!(await isHsConfigured())) return reply.code(503).send({ error: 'not configured' })
    try {
      const body = req.body as { user?: string; [k: string]: unknown }
      const forwardBody: Record<string, unknown> = { ...body }
      if (typeof body.user === 'string' && !/^\d+$/.test(body.user)) {
        forwardBody.user = await resolveUserNumericID(body.user)
      }
      const d = await hsApi<{ preAuthKey?: unknown }>('/api/v1/preauthkey', {
        method: 'POST',
        body: JSON.stringify(forwardBody),
      })
      return { preAuthKey: d.preAuthKey ?? {} }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })

  app.post('/api/users/:user/preauthkeys/expire', async (req, reply) => {
    if (!(await isHsConfigured())) return reply.code(503).send({ error: 'not configured' })
    const { user } = req.params as { user: string }
    const { key } = req.body as { key?: string }
    if (!key) return reply.code(400).send({ error: 'key required' })
    try {
      const uid = await resolveUserNumericID(user)
      await hsApi('/api/v1/preauthkey/expire', {
        method: 'POST',
        body: JSON.stringify({ user: uid, key }),
      })
      return { ok: true }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
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
