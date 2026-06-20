import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { derpServers } from '../db/schema.js'
import { buildDerpMap, type DerpServerRow } from '../lib/build-derpmap.js'

/**
 * GET /derpmap.json — endpoint headscale fetch qua derp.urls.
 * PUBLIC (không auth): headscale gọi server-to-server, nội dung chỉ là hostname/IP relay công khai.
 */
export async function derpmapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/derpmap.json', async (_req, reply) => {
    const rows = (await db.select().from(derpServers)) as DerpServerRow[]
    const map = buildDerpMap(rows)
    reply.header('cache-control', 'no-store')
    reply.header('content-type', 'application/json; charset=utf-8')
    return map
  })
}
