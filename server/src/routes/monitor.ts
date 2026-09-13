import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/middleware.js'
import { beszelConfigured, fetchSystems } from '../lib/beszel.js'

/** Trang Monitor: danh sách máy chủ + tài nguyên, đọc từ Beszel. */
export async function monitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/monitor/systems', { preHandler: requireAuth }, async (req, reply) => {
    if (!beszelConfigured()) {
      return reply.code(503).send({ error: 'monitor_not_configured' })
    }
    try {
      return { systems: await fetchSystems() }
    } catch (err) {
      req.log.warn({ err }, 'beszel fetch failed')
      return reply.code(502).send({
        error: 'beszel_unreachable',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
