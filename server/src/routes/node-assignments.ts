import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { derpNodeAssignments, derpNodeHealth, derpNodeOptions, derpServers } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../env.js'
import { buildExclusiveDerpMap, buildPerNodeDerpMap } from '../lib/build-derpmap.js'

/**
 * Public endpoint — gọi bởi headscale patch (Feature B).
 * Không cần login; bảo vệ bằng X-Headscale-Secret nếu env được set.
 */
export async function nodeAssignmentsPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { nodeKey: string } }>(
    '/api/internal/derp-map/:nodeKey',
    async (req, reply) => {
      if (env.HEADSCALE_DASHBOARD_SECRET) {
        const header = req.headers['x-headscale-secret']
        if (header !== env.HEADSCALE_DASHBOARD_SECRET) {
          return reply.code(401).send({ error: 'unauthorized' })
        }
      }

      const { nodeKey } = req.params

      const assignments = await db
        .select({ regionId: derpNodeAssignments.regionId })
        .from(derpNodeAssignments)
        .where(eq(derpNodeAssignments.nodeKey, nodeKey))

      // Không có assignment → 404 để headscale dùng base /derpmap.json (full map).
      if (assignments.length === 0) {
        return reply.code(404).send({ error: 'no_assignment' })
      }

      // UNION (mặc định): lấy TẤT CẢ region để node relay được tới mọi peer;
      // region không gán bị phạt priority (không chọn làm home). EXCLUSIVE
      // (derp_node_options.exclusive=true): map CHỈ gồm region được gán, loại
      // hẳn phần còn lại — client không còn gì khác để tự chuyển sang.
      const regionIds = assignments.map((a) => a.regionId)
      const servers = await db.select().from(derpServers)

      if (servers.length === 0) {
        return reply.code(404).send({ error: 'no_derp_servers' })
      }

      const [opts] = await db
        .select({ exclusive: derpNodeOptions.exclusive })
        .from(derpNodeOptions)
        .where(eq(derpNodeOptions.nodeKey, nodeKey))

      let useExclusive = !!opts?.exclusive
      if (useExclusive) {
        // Van an toan: region khoa chet lien tuc >=10 phut (status='fallback',
        // cap nhat boi tien trinh nen sweepExclusiveNodeHealth) -> tam phuc vu
        // map UNION binh thuong, khong de client bi ket cung.
        const [health] = await db
          .select({ status: derpNodeHealth.status })
          .from(derpNodeHealth)
          .where(eq(derpNodeHealth.nodeKey, nodeKey))
        if (health?.status === 'fallback') useExclusive = false
      }

      const map = useExclusive
        ? buildExclusiveDerpMap(servers, regionIds)
        : buildPerNodeDerpMap(servers, regionIds)

      return reply.send(map)
    }
  )
}

const putSchema = z.object({
  regionIds: z.array(z.number().int().positive()).min(0),
  exclusive: z.boolean().optional(),
})

/**
 * Admin CRUD — yêu cầu đăng nhập.
 */
export async function nodeAssignmentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** Danh sách tất cả assignments, grouped by node_key. */
  app.get('/api/node-assignments', async () => {
    const rows = await db
      .select({
        nodeKey:      derpNodeAssignments.nodeKey,
        regionId:     derpNodeAssignments.regionId,
        derpCode:     derpServers.code,
        derpName:     derpServers.name,
        derpHostname: derpServers.hostname,
      })
      .from(derpNodeAssignments)
      .leftJoin(derpServers, eq(derpNodeAssignments.regionId, derpServers.regionId))
      .orderBy(derpNodeAssignments.nodeKey, derpNodeAssignments.regionId)

    const exclusiveByNode = new Map(
      (await db.select().from(derpNodeOptions)).map((o) => [o.nodeKey, o.exclusive])
    )
    const healthByNode = new Map(
      (await db.select().from(derpNodeHealth)).map((h) => [h.nodeKey, h.status])
    )

    const grouped: Record<string, { nodeKey: string; exclusive: boolean; derpStatus: string | null; regions: { regionId: number; code: string; name: string; hostname: string }[] }> = {}
    for (const row of rows) {
      if (!grouped[row.nodeKey]) {
        grouped[row.nodeKey] = {
          nodeKey: row.nodeKey,
          exclusive: exclusiveByNode.get(row.nodeKey) ?? false,
          derpStatus: healthByNode.get(row.nodeKey) ?? null,
          regions: [],
        }
      }
      grouped[row.nodeKey].regions.push({
        regionId: row.regionId,
        code:     row.derpCode ?? '',
        name:     row.derpName ?? '',
        hostname: row.derpHostname ?? '',
      })
    }
    return Object.values(grouped)
  })

  /** Assignments của một node cụ thể. */
  app.get<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey',
    async (req, reply) => {
      const { nodeKey } = req.params
      const rows = await db
        .select({ regionId: derpNodeAssignments.regionId })
        .from(derpNodeAssignments)
        .where(eq(derpNodeAssignments.nodeKey, nodeKey))
      if (rows.length === 0) return reply.code(404).send({ error: 'not_found' })
      const [opts] = await db.select().from(derpNodeOptions).where(eq(derpNodeOptions.nodeKey, nodeKey))
      return { nodeKey, regionIds: rows.map((r) => r.regionId), exclusive: opts?.exclusive ?? false }
    }
  )

  /** Set region assignments cho một node (replace toàn bộ danh sách) + cờ exclusive. */
  app.put<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey',
    async (req, reply) => {
      const { nodeKey } = req.params
      const parsed = putSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })
      }

      const { regionIds, exclusive } = parsed.data
      await db.transaction(async (tx) => {
        await tx.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, nodeKey))
        if (regionIds.length > 0) {
          await tx.insert(derpNodeAssignments).values(
            regionIds.map((regionId) => ({ nodeKey, regionId }))
          )
        }
        if (exclusive !== undefined) {
          await tx
            .insert(derpNodeOptions)
            .values({ nodeKey, exclusive })
            .onConflictDoUpdate({ target: derpNodeOptions.nodeKey, set: { exclusive } })
        }
      })

      return { nodeKey, regionIds, exclusive: exclusive ?? false }
    }
  )

  /** Xóa tất cả assignments của một node. */
  app.delete<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey',
    async (req, reply) => {
      await db.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, req.params.nodeKey))
      await db.delete(derpNodeOptions).where(eq(derpNodeOptions.nodeKey, req.params.nodeKey))
      await db.delete(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, req.params.nodeKey))
      return reply.code(204).send()
    }
  )

  /** "Reload" khóa DERP — xóa trạng thái sức khỏe đang lưu (kể cả đang ở
   *  'fallback' sau 10 phút chết) để lần probe nền kế tiếp (≤30s) đánh giá lại
   *  từ đầu, và ép quay về exclusive ngay nếu region đã sống lại. */
  app.post<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey/reload-derp',
    async (req) => {
      await db.delete(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, req.params.nodeKey))
      return { ok: true }
    }
  )
}
