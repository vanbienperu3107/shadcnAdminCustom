import type { FastifyInstance } from 'fastify'
import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { derpServers } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { nextRegionId } from '../lib/region-id.js'
import { probeHost } from '../lib/probe.js'

const createSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  nodeName: z.string().min(1).max(64),
  hostname: z.string().min(1).max(255),
  ipv4: z.string().max(45).nullish(),
  ipv6: z.string().max(45).nullish(),
  derpPort: z.number().int().min(1).max(65535).default(443),
  stunPort: z.number().int().min(-1).max(65535).default(3478),
  canPort80: z.boolean().default(false),
  stunOnly: z.boolean().default(false),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  enabled: z.boolean().default(true),
  paused: z.boolean().default(false),
  priority: z.number().int().min(1).max(1000).default(100),
})

const updateSchema = createSchema.partial()
const toggleSchema = z.object({ enabled: z.boolean().optional(), paused: z.boolean().optional() })

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

export async function derpRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // Danh sách (embedded lên đầu, rồi theo region_id)
  app.get('/api/derp', async () => {
    return db
      .select()
      .from(derpServers)
      .orderBy(desc(derpServers.embedded), asc(derpServers.regionId))
  })

  // Preview region_id sẽ cấp khi thêm mới (cho modal hiển thị)
  app.get('/api/derp/next-region-id', async () => {
    const rows = await db.select({ regionId: derpServers.regionId }).from(derpServers)
    return { regionId: nextRegionId(rows.map((r) => r.regionId)) }
  })

  // Re-probe HEALTH THẬT: ping HTTPS /derp/probe (hoặc /relay/probe) từng node,
  // verify TLS như client. Trả về up/down + latency. Probe song song.
  app.get('/api/derp/health', async () => {
    // Bỏ qua region embedded (999, vpn2): /derp/probe public bị Caddy route sang
    // node-dedup nên không probe được derper thật -> UI hiển thị "control" riêng.
    const rows = await db
      .select({
        regionId: derpServers.regionId,
        hostname: derpServers.hostname,
        derpPort: derpServers.derpPort,
      })
      .from(derpServers)
      .where(eq(derpServers.embedded, false))
      .orderBy(asc(derpServers.regionId))
    const results = await Promise.all(
      rows.map(async (r) => ({
        regionId: r.regionId,
        ...(await probeHost(r.hostname, r.derpPort)),
      }))
    )
    return results
  })

  // Thêm mới — region_id tự cấp, không trùng, không là 999
  app.post('/api/derp', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })
    const used = await db.select({ regionId: derpServers.regionId }).from(derpServers)
    const regionId = nextRegionId(used.map((r) => r.regionId))
    try {
      const [row] = await db
        .insert(derpServers)
        .values({ ...parsed.data, regionId, embedded: false })
        .returning()
      return reply.code(201).send(row)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'conflict', message: 'code hoặc node_name đã tồn tại' })
      }
      throw err
    }
  })

  // Sửa
  app.patch<{ Params: { regionId: string } }>('/api/derp/:regionId', async (req, reply) => {
    const regionId = Number(req.params.regionId)
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })
    const [existing] = await db.select().from(derpServers).where(eq(derpServers.regionId, regionId))
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.embedded) return reply.code(403).send({ error: 'embedded_readonly' })
    try {
      const [row] = await db
        .update(derpServers)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(derpServers.regionId, regionId))
        .returning()
      return row
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'conflict', message: 'code hoặc node_name đã tồn tại' })
      }
      throw err
    }
  })

  // Bật/tắt (ON/OFF) hoặc tạm dừng
  app.post<{ Params: { regionId: string } }>('/api/derp/:regionId/toggle', async (req, reply) => {
    const regionId = Number(req.params.regionId)
    const parsed = toggleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' })
    const [existing] = await db.select().from(derpServers).where(eq(derpServers.regionId, regionId))
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.embedded) return reply.code(403).send({ error: 'embedded_readonly' })
    const [row] = await db
      .update(derpServers)
      .set({
        enabled: parsed.data.enabled ?? existing.enabled,
        paused: parsed.data.paused ?? existing.paused,
        updatedAt: new Date(),
      })
      .where(eq(derpServers.regionId, regionId))
      .returning()
    return row
  })

  // Xóa
  app.delete<{ Params: { regionId: string } }>('/api/derp/:regionId', async (req, reply) => {
    const regionId = Number(req.params.regionId)
    const [existing] = await db.select().from(derpServers).where(eq(derpServers.regionId, regionId))
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.embedded) return reply.code(403).send({ error: 'embedded_readonly' })
    await db.delete(derpServers).where(eq(derpServers.regionId, regionId))
    return reply.code(204).send()
  })
}
