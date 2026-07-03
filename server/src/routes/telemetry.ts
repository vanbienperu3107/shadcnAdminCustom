import { z } from 'zod'
import { desc } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { clientDerpPing, clientHomeDerp } from '../db/schema.js'
import { env } from '../env.js'

/** Kiểm tra X-Headscale-Secret (giống client-runtime.ts). Trả true nếu OK. */
function checkSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.HEADSCALE_DASHBOARD_SECRET) return true
  if (req.headers['x-headscale-secret'] === env.HEADSCALE_DASHBOARD_SECRET)
    return true
  reply.code(401).send({ error: 'unauthorized' })
  return false
}

const homeDerpSchema = z.object({
  mac: z.string().min(1),
  hostname: z.string().min(1),
  homeRegionId: z.number().int().nullish(),
  homeRegionCode: z.string().nullish(),
  controllerLatencyMs: z.number().nullish(),
})

const derpPingSampleSchema = z.object({
  regionId: z.number().int(),
  regionCode: z.string().nullish(),
  rttMs: z.number().nullish(),
  ok: z.boolean().default(true),
})

const derpPingBodySchema = z.object({
  client: z.string().min(1), // mac
  samples: z.array(derpPingSampleSchema),
})

/**
 * Public — gọi bởi client mod (homederpreport.go mỗi 3s, derppingreport.go mỗi 30s).
 * Bảo vệ bằng X-Headscale-Secret nếu env được set (giống client-runtime).
 */
export async function telemetryPublicRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post('/api/telemetry/home-derp', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const parsed = homeDerpSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const { mac, hostname, homeRegionId, homeRegionCode, controllerLatencyMs } =
      parsed.data
    await db
      .insert(clientHomeDerp)
      .values({
        mac,
        hostname,
        homeRegionId,
        homeRegionCode,
        controllerLatencyMs,
        reportedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: clientHomeDerp.mac,
        set: {
          hostname,
          homeRegionId,
          homeRegionCode,
          controllerLatencyMs,
          reportedAt: new Date(),
        },
      })
    return { ok: true }
  })

  app.post('/api/telemetry/derp-ping', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const parsed = derpPingBodySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const { client, samples } = parsed.data
    const reportedAt = new Date()
    for (const s of samples) {
      await db
        .insert(clientDerpPing)
        .values({
          client,
          regionId: s.regionId,
          regionCode: s.regionCode,
          rttMs: s.rttMs,
          ok: s.ok,
          reportedAt,
        })
        .onConflictDoUpdate({
          target: [clientDerpPing.client, clientDerpPing.regionId],
          set: {
            regionCode: s.regionCode,
            rttMs: s.rttMs,
            ok: s.ok,
            reportedAt,
          },
        })
    }
    return { ok: true }
  })
}

/** Admin đọc — yêu cầu đăng nhập, dùng cho dashboard. */
export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/telemetry/home-derp', async () => {
    return db
      .select()
      .from(clientHomeDerp)
      .orderBy(desc(clientHomeDerp.reportedAt))
  })

  app.get('/api/telemetry/derp-ping', async () => {
    return db
      .select()
      .from(clientDerpPing)
      .orderBy(desc(clientDerpPing.reportedAt))
  })
}
