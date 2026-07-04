import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { deviceIdentity } from '../db/schema.js'
import { backfillDeviceRegistry } from '../lib/device-registry.js'

const patchSchema = z.object({
  managedUser: z.string().nullish(),
  staticIpv4: z.string().nullish(),
})

/**
 * Admin — device registry hợp nhất (client + derp_infra), xem
 * lib/device-registry.ts. Dùng để frontend phân loại machine thay vì đoán
 * qua tên (derpNameSet/isDerpNode).
 */
export async function devicesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/devices', async () => {
    const rows = await db
      .select({
        id: deviceIdentity.id,
        mac: deviceIdentity.mac,
        nodeKey: deviceIdentity.nodeKey,
        hostname: deviceIdentity.hostname,
        managedUser: deviceIdentity.managedUser,
        deviceType: deviceIdentity.deviceType,
        lastIpv4: deviceIdentity.lastIpv4,
        staticIpv4: deviceIdentity.staticIpv4,
        updatedAt: deviceIdentity.updatedAt,
      })
      .from(deviceIdentity)
    return rows
  })

  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db
      .update(deviceIdentity)
      .set({
        ...(parsed.data.managedUser !== undefined && {
          managedUser: parsed.data.managedUser,
        }),
        ...(parsed.data.staticIpv4 !== undefined && {
          staticIpv4: parsed.data.staticIpv4,
        }),
        updatedAt: new Date(),
      })
      .where(eq(deviceIdentity.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return row
  })

  // Backfill 1 lần — kích hoạt tay từ CMS, KHÔNG chạy tự động lúc migrate/boot
  // (tránh phụ thuộc headscale API trong đường khởi động server).
  app.post('/api/devices/backfill', async (_req, reply) => {
    try {
      const result = await backfillDeviceRegistry()
      return result
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
