import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { ok: true, db: 'up' }
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' })
    }
  })
}
