import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import {
  getApiKeyStatus,
  refreshApiKey,
  setApiKey,
} from '../lib/apikey-manager.js'
import { env } from '../env.js'

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** Repo chính (shadcnAdminCustom) lấy từ GITHUB_REPOS env. */
function primaryRepo(): { owner: string; repo: string } | null {
  const first = env.GITHUB_REPOS.split(',')[0]?.trim()
  if (!first) return null
  const [owner, repo] = first.split('/')
  if (!owner || !repo) return null
  return { owner, repo }
}

/** Gọi GitHub API dispatch workflow `create-headscale-key.yml`. */
async function dispatchCreateKeyWorkflow(callbackUrl: string): Promise<void> {
  const r = primaryRepo()
  if (!r) throw new Error('GITHUB_REPOS chưa cấu hình')
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN chưa cấu hình')

  const url = `https://api.github.com/repos/${r.owner}/${r.repo}/actions/workflows/create-headscale-key.yml/dispatches`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ref: env.GITHUB_WORKFLOW_REF,
      inputs: { callback_url: callbackUrl },
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`GitHub dispatch ${res.status}: ${msg}`)
  }
  // 204 No Content on success
}

// ──────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────
export async function apikeyRoutes(app: FastifyInstance): Promise<void> {
  // ── Endpoints cần đăng nhập ────────────────────────────────────

  app.get('/api/settings/apikey', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      return await getApiKeyStatus()
    } catch (e) {
      return reply.code(500).send({ error: String(e) })
    }
  })

  // Tạo key tự động: backend dispatch GitHub workflow → workflow SSH → tạo key → webhook
  app.post(
    '/api/settings/apikey/generate',
    { preHandler: requireAuth },
    async (_req, reply) => {
      if (!env.GITHUB_TOKEN) {
        return reply
          .code(503)
          .send({ error: 'GITHUB_TOKEN chưa cấu hình — cần PAT có scope workflow' })
      }
      try {
        const callbackUrl = `${env.PUBLIC_URL}/api/settings/apikey/webhook`
        await dispatchCreateKeyWorkflow(callbackUrl)
        return { dispatched: true, message: 'Workflow đã được kích hoạt (~1 phút)' }
      } catch (e) {
        return reply.code(500).send({ error: String(e) })
      }
    }
  )

  // Xoay vòng key thủ công (dùng key hiện tại để tạo key mới + expire cũ)
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

  // ── Webhook — KHÔNG cần Google auth, validate bằng SESSION_SECRET ──
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
