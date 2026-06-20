import type { FastifyInstance } from 'fastify'
import { env } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import { hsApi, nodededup } from '../lib/headscale.js'

/** Proxy headscale API (machines/users) + node-dedup (latency). Đều cần auth. */
export async function headscaleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // Machines (nodes) từ headscale
  app.get('/api/machines', async (_req, reply) => {
    if (!env.HEADSCALE_API_KEY) return { configured: false, nodes: [] }
    try {
      const d = await hsApi<{ nodes?: unknown[] }>('/api/v1/node')
      return { configured: true, nodes: d.nodes ?? [] }
    } catch (e) {
      return reply.code(502).send({ configured: true, error: String(e), nodes: [] })
    }
  })

  // Users từ headscale
  app.get('/api/users', async (_req, reply) => {
    if (!env.HEADSCALE_API_KEY) return { configured: false, users: [] }
    try {
      const d = await hsApi<{ users?: unknown[] }>('/api/v1/user')
      return { configured: true, users: d.users ?? [] }
    } catch (e) {
      return reply.code(502).send({ configured: true, error: String(e), users: [] })
    }
  })

  // Latency giữa các node (node-dedup) — { window_s, pairs: [...] }
  app.get('/api/latency', async (_req, reply) => {
    try {
      return await nodededup('/metrics/latency')
    } catch (e) {
      return reply.code(502).send({ error: String(e), pairs: [] })
    }
  })
}
