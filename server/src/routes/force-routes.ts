import type { FastifyInstance } from 'fastify'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { derpForceRoutes, derpServers } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { clearFirewallRules, syncFirewallRules } from '../lib/firewall-sync.js'

const createSchema = z.object({
  regionId: z.number().int().positive(),
  clientIp: z
    .string()
    .min(1)
    .regex(/^[\d.:a-fA-F/]+$/, 'IP không hợp lệ'),
  label: z.string().max(128).optional(),
  active: z.boolean().default(true),
})

export async function forceRouteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** Danh sách tất cả force routes (kèm thông tin DERP). */
  app.get('/api/force-routes', async () => {
    return db
      .select({
        id:        derpForceRoutes.id,
        regionId:  derpForceRoutes.regionId,
        clientIp:  derpForceRoutes.clientIp,
        label:     derpForceRoutes.label,
        active:    derpForceRoutes.active,
        createdAt: derpForceRoutes.createdAt,
        // DERP info
        derpCode:     derpServers.code,
        derpName:     derpServers.name,
        derpHostname: derpServers.hostname,
        sshUser:      derpServers.sshUser,
        sshPort:      derpServers.sshPort,
      })
      .from(derpForceRoutes)
      .leftJoin(derpServers, eq(derpForceRoutes.regionId, derpServers.regionId))
      .orderBy(asc(derpForceRoutes.regionId), asc(derpForceRoutes.createdAt))
  })

  /** Tạo force route mới. */
  app.post('/api/force-routes', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })

    const [server] = await db.select().from(derpServers).where(eq(derpServers.regionId, parsed.data.regionId))
    if (!server) return reply.code(404).send({ error: 'derp_not_found' })
    if (server.embedded) return reply.code(403).send({ error: 'embedded_readonly' })

    const [row] = await db.insert(derpForceRoutes).values(parsed.data).returning()
    return reply.code(201).send(row)
  })

  /** Bật/tắt active. */
  app.patch<{ Params: { id: string } }>('/api/force-routes/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const body = req.body as { active?: boolean; label?: string }
    const [existing] = await db.select().from(derpForceRoutes).where(eq(derpForceRoutes.id, id))
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    const [row] = await db
      .update(derpForceRoutes)
      .set({
        active: body.active ?? existing.active,
        label:  body.label  ?? existing.label,
      })
      .where(eq(derpForceRoutes.id, id))
      .returning()
    return row
  })

  /** Xóa. */
  app.delete<{ Params: { id: string } }>('/api/force-routes/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const [existing] = await db.select().from(derpForceRoutes).where(eq(derpForceRoutes.id, id))
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    await db.delete(derpForceRoutes).where(eq(derpForceRoutes.id, id))
    return reply.code(204).send()
  })

  /** Sync iptables DERP-FORCE trên DERP node. */
  app.post<{ Params: { regionId: string } }>('/api/force-routes/sync/:regionId', async (req, reply) => {
    const regionId = Number(req.params.regionId)
    const [server] = await db.select().from(derpServers).where(eq(derpServers.regionId, regionId))
    if (!server) return reply.code(404).send({ error: 'derp_not_found' })
    if (server.embedded) return reply.code(403).send({ error: 'embedded_readonly' })

    const routes = await db
      .select()
      .from(derpForceRoutes)
      .where(eq(derpForceRoutes.regionId, regionId))

    const activeIps = routes.filter((r) => r.active).map((r) => r.clientIp)

    const result = await syncFirewallRules(
      server.hostname,
      server.sshUser ?? 'root',
      server.sshPort ?? 22,
      activeIps
    )

    return reply.code(result.ok ? 200 : 502).send(result)
  })

  /** Xóa hết rules DERP-FORCE trên DERP node. */
  app.post<{ Params: { regionId: string } }>('/api/force-routes/clear/:regionId', async (req, reply) => {
    const regionId = Number(req.params.regionId)
    const [server] = await db.select().from(derpServers).where(eq(derpServers.regionId, regionId))
    if (!server) return reply.code(404).send({ error: 'derp_not_found' })
    if (server.embedded) return reply.code(403).send({ error: 'embedded_readonly' })

    const result = await clearFirewallRules(
      server.hostname,
      server.sshUser ?? 'root',
      server.sshPort ?? 22
    )
    return reply.code(result.ok ? 200 : 502).send(result)
  })
}
