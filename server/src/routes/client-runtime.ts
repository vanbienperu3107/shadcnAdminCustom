import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { clientConfig, nodeRuntimeConfig, pacRules } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../env.js'
import { resolveRuntimeConfig, type NodeRuntimeRow } from '../lib/runtime-config.js'
import { buildPac, type PacRuleRow } from '../lib/build-pac.js'

/** Kiểm tra X-Headscale-Secret (giống node-assignments). Trả true nếu OK. */
function checkSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.HEADSCALE_DASHBOARD_SECRET) return true
  if (req.headers['x-headscale-secret'] === env.HEADSCALE_DASHBOARD_SECRET) return true
  reply.code(401).send({ error: 'unauthorized' })
  return false
}

/** Tra node_runtime_config theo mac (chính), fallback hostname (phụ). */
async function findNode(mac?: string, host?: string): Promise<NodeRuntimeRow | null> {
  if (mac) {
    const [row] = await db.select().from(nodeRuntimeConfig).where(eq(nodeRuntimeConfig.mac, mac))
    if (row) return row
  }
  if (host) {
    const [row] = await db.select().from(nodeRuntimeConfig).where(eq(nodeRuntimeConfig.hostname, host))
    if (row) return row
  }
  return null
}

/**
 * Public — gọi bởi client agent (bootstrap-config.ps1 lúc boot, pac-agent.ps1 mỗi 30s).
 * Bảo vệ bằng X-Headscale-Secret nếu env được set.
 */
export async function clientRuntimePublicRoutes(app: FastifyInstance): Promise<void> {
  // Cấu hình runtime (merge per-node ⊃ global ⊃ default).
  app.get('/api/client/runtime', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const q = req.query as { mac?: string; host?: string }
    try {
      const node = await findNode(q.mac, q.host)
      const cfgRows = await db.select().from(clientConfig)
      const kv: Record<string, string> = {}
      for (const r of cfgRows) kv[r.key] = r.value

      const cfg = resolveRuntimeConfig(kv, node)
      const macQ = q.mac ? `?mac=${encodeURIComponent(q.mac)}` : ''
      return {
        ...cfg,
        pac_url: `${env.PUBLIC_URL}/api/client/pac${macQ}`,
        matched: node ? (node.mac === q.mac ? 'mac' : 'hostname') : 'default',
      }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })

  // PAC động (text). Client trỏ AutoConfigURL hoặc pac-agent serve lại từ RAM.
  app.get('/api/client/pac', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const q = req.query as { mac?: string }
    try {
      const rows = await db
        .select()
        .from(pacRules)
        .where(
          and(
            eq(pacRules.enabled, true),
            q.mac
              ? or(eq(pacRules.scope, 'global'), and(eq(pacRules.scope, 'node'), eq(pacRules.mac, q.mac)))
              : eq(pacRules.scope, 'global'),
          ),
        )
      const pac = buildPac(rows as unknown as PacRuleRow[])
      return reply
        .header('Content-Type', 'application/x-ns-proxy-autoconfig')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .send(pac)
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}

const nodeSchema = z.object({
  hostname:          z.string().nullish(),
  mode:              z.string().nullish(),
  loginServer:       z.string().nullish(),
  alwaysUseDerp:     z.boolean().nullish(),
  derpKeepaliveSecs: z.number().int().nullish(),
  peerHttpProxy:     z.string().nullish(),
  socksAddr:         z.string().nullish(),
  advertiseRoutes:   z.string().nullish(),
  lanRoutes:         z.string().nullish(),
  pacServerPort:     z.number().int().nullish(),
})

const pacRuleSchema = z.object({
  scope:       z.enum(['global', 'node']).default('global'),
  mac:         z.string().nullish(),
  kind:        z.enum(['domain', 'subnet']),
  pattern:     z.string().min(1),
  proxyTarget: z.string().min(1),
  priority:    z.number().int().default(100),
  enabled:     z.boolean().default(true),
})

/** Admin CRUD — yêu cầu đăng nhập. */
export async function clientRuntimeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // ----- node_runtime_config -----
  app.get('/api/node-runtime', async () => {
    return db.select().from(nodeRuntimeConfig).orderBy(nodeRuntimeConfig.mac)
  })

  app.put('/api/node-runtime/:mac', async (req, reply) => {
    const { mac } = req.params as { mac: string }
    const parsed = nodeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const values = { mac, ...parsed.data, updatedAt: new Date() }
    const [row] = await db
      .insert(nodeRuntimeConfig)
      .values(values)
      .onConflictDoUpdate({ target: nodeRuntimeConfig.mac, set: { ...parsed.data, updatedAt: new Date() } })
      .returning()
    return row
  })

  app.delete('/api/node-runtime/:mac', async (req) => {
    const { mac } = req.params as { mac: string }
    await db.delete(nodeRuntimeConfig).where(eq(nodeRuntimeConfig.mac, mac))
    return { ok: true }
  })

  // ----- pac_rules -----
  app.get('/api/pac-rules', async () => {
    return db.select().from(pacRules).orderBy(pacRules.priority, pacRules.id)
  })

  // Xem truoc PAC da render (admin, khong can secret) — global + optional ?mac=.
  app.get('/api/pac-rules/preview', async (req, reply) => {
    const q = req.query as { mac?: string }
    const rows = await db
      .select()
      .from(pacRules)
      .where(
        and(
          eq(pacRules.enabled, true),
          q.mac
            ? or(eq(pacRules.scope, 'global'), and(eq(pacRules.scope, 'node'), eq(pacRules.mac, q.mac)))
            : eq(pacRules.scope, 'global'),
        ),
      )
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send(buildPac(rows as unknown as PacRuleRow[]))
  })

  app.post('/api/pac-rules', async (req, reply) => {
    const parsed = pacRuleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db.insert(pacRules).values(parsed.data).returning()
    return row
  })

  app.put('/api/pac-rules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = pacRuleSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db.update(pacRules).set(parsed.data).where(eq(pacRules.id, id)).returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return row
  })

  app.delete('/api/pac-rules/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    await db.delete(pacRules).where(eq(pacRules.id, id))
    return { ok: true }
  })

  app.post('/api/pac-rules/:id/toggle', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const [cur] = await db.select().from(pacRules).where(eq(pacRules.id, id))
    if (!cur) return reply.code(404).send({ error: 'not found' })
    const [row] = await db.update(pacRules).set({ enabled: !cur.enabled }).where(eq(pacRules.id, id)).returning()
    return row
  })
}
