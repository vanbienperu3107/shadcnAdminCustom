import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { derpNodeAssignments, derpServers } from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../env.js'
import { buildPerNodeDerpMap } from '../lib/build-derpmap.js'

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

      // UNION: lấy TẤT CẢ region (không chỉ region được gán) để node relay được tới
      // mọi peer; region không gán bị phạt priority (không chọn làm home).
      const regionIds = assignments.map((a) => a.regionId)
      const servers = await db.select().from(derpServers)

      if (servers.length === 0) {
        return reply.code(404).send({ error: 'no_derp_servers' })
      }

      return reply.send(buildPerNodeDerpMap(servers, regionIds))
    }
  )
}

const putSchema = z.object({
  regionIds: z.array(z.number().int().positive()).min(0),
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

    const grouped: Record<string, { nodeKey: string; regions: { regionId: number; code: string; name: string; hostname: string }[] }> = {}
    for (const row of rows) {
      if (!grouped[row.nodeKey]) {
        grouped[row.nodeKey] = { nodeKey: row.nodeKey, regions: [] }
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
      return { nodeKey, regionIds: rows.map((r) => r.regionId) }
    }
  )

  /** Set region assignments cho một node (replace toàn bộ danh sách). */
  app.put<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey',
    async (req, reply) => {
      const { nodeKey } = req.params
      const parsed = putSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })
      }

      const { regionIds } = parsed.data
      await db.transaction(async (tx) => {
        await tx.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, nodeKey))
        if (regionIds.length > 0) {
          await tx.insert(derpNodeAssignments).values(
            regionIds.map((regionId) => ({ nodeKey, regionId }))
          )
        }
      })

      return { nodeKey, regionIds }
    }
  )

  /** Xóa tất cả assignments của một node. */
  app.delete<{ Params: { nodeKey: string } }>(
    '/api/node-assignments/:nodeKey',
    async (req, reply) => {
      await db.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, req.params.nodeKey))
      return reply.code(204).send()
    }
  )
}
