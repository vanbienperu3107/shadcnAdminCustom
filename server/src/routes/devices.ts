import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { clientHomeDerp, deviceIdentity } from '../db/schema.js'
import {
  backfillDeviceRegistry,
  isDeviceOnline,
} from '../lib/device-registry.js'

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
        clientVersion: deviceIdentity.clientVersion,
        clientBuild: deviceIdentity.clientBuild,
        clientVariant: deviceIdentity.clientVariant,
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

  // Màn hình Machines realtime (poll 1s): MỖI DÒNG LẤY TỪ DB, không gọi
  // headscale (nhanh, chịu được poll 1s). MAC | Name | IP | Version | State |
  // Last seen. IP = static_ipv4 (admin gán) ưu tiên, sau đó last_ipv4. Trạng
  // thái online suy từ tín hiệu telemetry mới nhất trong DB (client_home_derp
  // client mod báo ~3s/lần), không phụ thuộc headscale. nodeKey/id kèm theo để
  // các nút hành động (đổi tên/thu hồi/xóa/IP tĩnh) tra ngược khi cần.
  app.get('/api/devices/live', async () => {
    const devs = await db
      .select({
        id: deviceIdentity.id,
        mac: deviceIdentity.mac,
        nodeKey: deviceIdentity.nodeKey,
        hostname: deviceIdentity.hostname,
        lastIpv4: deviceIdentity.lastIpv4,
        staticIpv4: deviceIdentity.staticIpv4,
        clientVersion: deviceIdentity.clientVersion,
        clientBuild: deviceIdentity.clientBuild,
        clientVariant: deviceIdentity.clientVariant,
        updatedAt: deviceIdentity.updatedAt,
      })
      .from(deviceIdentity)
      .where(eq(deviceIdentity.deviceType, 'client'))
    const home = await db
      .select({ mac: clientHomeDerp.mac, reportedAt: clientHomeDerp.reportedAt })
      .from(clientHomeDerp)
    const homeMap = new Map(home.map((h) => [h.mac, h.reportedAt]))
    const now = Date.now()
    return devs.map((d) => {
      // Tín hiệu "thấy gần nhất": ưu tiên home-derp (báo ~3s/lần khi online),
      // fallback updatedAt (lần register gần nhất).
      const homeSeen = d.mac ? homeMap.get(d.mac) : undefined
      const seen = homeSeen ?? d.updatedAt
      const seenMs = seen ? new Date(seen).getTime() : null
      return {
        id: d.id,
        mac: d.mac,
        nodeKey: d.nodeKey,
        name: d.hostname,
        ip: d.staticIpv4 || d.lastIpv4,
        staticIp: d.staticIpv4,
        version: d.clientVersion,
        build: d.clientBuild,
        variant: d.clientVariant,
        lastSeen: seen ? new Date(seen).toISOString() : null,
        online: isDeviceOnline(seenMs, now),
      }
    })
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
