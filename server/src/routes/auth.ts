import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { allowedEmails, authOptional, env, googleEnabled, isProd } from '../env.js'
import { buildAuthUrl, decodeIdToken, exchangeCode } from '../auth/google.js'
import { createSession, destroySession, getSessionUser } from '../auth/session.js'
import { DEV_USER } from '../auth/middleware.js'

const STATE_COOKIE = 'derp_oauth_state'
const SPA_BASE = env.CORS_ORIGIN || env.PUBLIC_URL

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Bắt đầu đăng nhập Google
  app.get('/api/auth/google/login', async (req, reply) => {
    if (!googleEnabled) {
      return reply.code(503).send({ error: 'google_oauth_not_configured' })
    }
    const state = randomBytes(16).toString('base64url')
    reply.setCookie(STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 600,
    })
    return reply.redirect(buildAuthUrl(state))
  })

  // Callback: đổi code lấy token, kiểm whitelist, tạo session
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      const { code, state, error } = req.query
      if (error) return reply.redirect(`${SPA_BASE}/sign-in?error=${encodeURIComponent(error)}`)
      const expected = req.cookies?.[STATE_COOKIE]
      if (!code || !state || !expected || state !== expected) {
        return reply.redirect(`${SPA_BASE}/sign-in?error=invalid_state`)
      }
      reply.clearCookie(STATE_COOKIE, { path: '/' })
      try {
        const tokens = await exchangeCode(code)
        const profile = decodeIdToken(tokens.id_token)
        if (!profile.email_verified) {
          return reply.redirect(`${SPA_BASE}/sign-in?error=email_unverified`)
        }
        if (allowedEmails.length > 0 && !allowedEmails.includes(profile.email)) {
          return reply.redirect(`${SPA_BASE}/sign-in?error=not_allowed`)
        }
        await createSession(reply, profile, tokens)
        return reply.redirect(`${SPA_BASE}/`)
      } catch (err) {
        req.log.error(err, 'google callback failed')
        return reply.redirect(`${SPA_BASE}/sign-in?error=oauth_failed`)
      }
    }
  )

  // User hiện tại
  app.get('/api/auth/me', async (req, reply) => {
    const user = await getSessionUser(req)
    if (!user) {
      if (authOptional) return DEV_USER
      return reply.code(401).send({ error: 'unauthorized' })
    }
    return user
  })

  // Đăng xuất
  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply)
    return { ok: true }
  })
}
