import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import {
  getApiKeyStatus,
  refreshApiKey,
  setApiKey,
} from '../lib/apikey-manager.js'
import { env } from '../env.js'

export async function apikeyRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings/apikey — trạng thái key hiện tại
  app.get('/api/settings/apikey', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      return await getApiKeyStatus()
    } catch (e) {
      return reply.code(500).send({ error: String(e) })
    }
  })

  // POST /api/settings/apikey/refresh — xoay vòng key bằng headscale REST (cần key hiện có)
  app.post(
    '/api/settings/apikey/refresh',
    { preHandler: requireAuth },
    async (_req, reply) => {
      try {
        await refreshApiKey()
        return await getApiKeyStatus()
      } catch (e) {
        return reply.code(500).send({ error: String(e) })
      }
    }
  )

  // POST /api/settings/apikey/webhook — nhận key từ deploy workflow (không cần Google auth)
  // Xác thực bằng X-Webhook-Secret header = SESSION_SECRET
  const webhookBody = z.object({ key: z.string().min(10) })

  app.post(
    '/api/settings/apikey/webhook',
    async (req: FastifyRequest, reply) => {
      const secret = (req.headers['x-webhook-secret'] as string | undefined) ?? ''
      if (!secret || secret !== env.SESSION_SECRET) {
        return reply.code(401).send({ error: 'invalid webhook secret' })
      }
      const parsed = webhookBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'missing key in body' })
      }
      try {
        await setApiKey(parsed.data.key)
        app.log.info('[apikey-webhook] key received and stored in DB')
        return { ok: true }
      } catch (e) {
        return reply.code(500).send({ error: String(e) })
      }
    }
  )
}
