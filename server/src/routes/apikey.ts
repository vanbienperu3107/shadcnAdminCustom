import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import {
  getApiKeyStatus,
  refreshApiKey,
  setApiKey,
} from '../lib/apikey-manager.js'

export async function apikeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // Trạng thái key hiện tại (prefix ẩn, thời điểm seed/refresh, next refresh)
  app.get('/api/settings/apikey', async (_req, reply) => {
    try {
      return await getApiKeyStatus()
    } catch (e) {
      return reply.code(500).send({ error: String(e) })
    }
  })

  // Admin nhập key ban đầu qua UI (bootstrap khi DB chưa có key)
  const seedBody = z.object({ key: z.string().min(10, 'key quá ngắn') })
  app.post('/api/settings/apikey/seed', async (req, reply) => {
    const parsed = seedBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message })
    try {
      await setApiKey(parsed.data.key)
      return await getApiKeyStatus()
    } catch (e) {
      return reply.code(500).send({ error: String(e) })
    }
  })

  // Kích hoạt xoay vòng key ngay lập tức (tạo key mới, expire key cũ)
  app.post('/api/settings/apikey/refresh', async (_req, reply) => {
    try {
      await refreshApiKey()
      return await getApiKeyStatus()
    } catch (e) {
      return reply.code(500).send({ error: String(e) })
    }
  })
}
