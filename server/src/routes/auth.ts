import { randomBytes, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { allowedEmails, authOptional, env, googleEnabled, isProd } from '../env.js'
import { buildAuthUrl, decodeIdToken, exchangeCode } from '../auth/google.js'
import {
  MAX_MFA_ATTEMPTS,
  SESSION_COOKIE,
  bumpMfaAttempts,
  createSession,
  createSessionForUser,
  destroySession,
  getSessionUser,
  lookupPendingSession,
  promoteSession,
} from '../auth/session.js'
import { DEV_USER, requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password.js'
import {
  buildOtpauthUri,
  generateTotpSecret,
  verifyTotpDetailed,
} from '../lib/totp.js'

/** So sánh 2 chuỗi timing-safe (độ dài có thể khác nhau). */
function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

const STATE_COOKIE = 'derp_oauth_state'
const SPA_BASE = env.CORS_ORIGIN || env.PUBLIC_URL

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
})
const codeSchema = z.object({
  code: z.string().min(6).max(8),
})
const enableSchema = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().min(6).max(8),
})
const disableSchema = z.object({
  password: z.string().min(1).max(200),
})
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
})

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ----- Google OAuth (giữ nguyên luồng cũ) -----
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

  // ----- Đăng nhập nội bộ: username + password (+ 2FA) -----
  // Bước 1: xác thực mật khẩu. Nếu user đã bật 2FA -> trả mfaRequired, session
  // ở trạng thái pending (chưa dùng được cho tới khi verify-2fa). Ngược lại tạo
  // session đầy đủ ngay.
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }
    const username = parsed.data.username.trim().toLowerCase()
    const rows = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        totpEnabled: users.totpEnabled,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)
    const user = rows[0]
    // Thông báo chung + thời gian phản hồi đều để tránh user enumeration:
    // nếu không có user/hash thì chạy scrypt "giả" burn thời gian tương đương.
    let ok = false
    if (user?.passwordHash) {
      ok = await verifyPassword(parsed.data.password, user.passwordHash)
    } else {
      await dummyVerify(parsed.data.password)
    }
    if (!user || !ok) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    if (user.totpEnabled) {
      await createSessionForUser(reply, user.id, { pending2fa: true })
      return { mfaRequired: true }
    }
    await createSessionForUser(reply, user.id)
    return { ok: true, mfaRequired: false }
  })

  // Bước 2: xác minh mã TOTP cho session đang pending. Có khóa sau MAX_MFA_ATTEMPTS
  // lần sai (buộc đăng nhập lại) + rate limit IP + chống replay theo counter.
  app.post('/api/auth/login/verify-2fa', {
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const sid = req.cookies?.[SESSION_COOKIE]
    if (!sid) return reply.code(401).send({ error: 'no_pending_session' })

    const pending = await lookupPendingSession(sid)
    if (!pending || !pending.totpEnabled || !pending.totpSecret) {
      return reply.code(401).send({ error: 'no_pending_session' })
    }
    // Đã sai quá ngưỡng -> hủy session, buộc đăng nhập lại từ đầu.
    if (pending.mfaAttempts >= MAX_MFA_ATTEMPTS) {
      await destroySession(req, reply)
      return reply.code(429).send({ error: 'too_many_attempts' })
    }
    const matchedCounter = verifyTotpDetailed(pending.totpSecret, parsed.data.code, {
      afterCounter: pending.totpLastCounter ?? -1,
    })
    if (matchedCounter === -1) {
      const attempts = await bumpMfaAttempts(sid)
      if (attempts >= MAX_MFA_ATTEMPTS) {
        await destroySession(req, reply)
        return reply.code(429).send({ error: 'too_many_attempts' })
      }
      return reply.code(401).send({ error: 'invalid_code' })
    }
    // Lưu counter đã dùng (chống replay) rồi mới nâng session.
    await db
      .update(users)
      .set({ totpLastCounter: matchedCounter })
      .where(eq(users.id, pending.userId))
    const promoted = await promoteSession(sid, reply)
    if (!promoted) return reply.code(401).send({ error: 'no_pending_session' })
    return { ok: true }
  })

  // ----- User hiện tại -----
  app.get('/api/auth/me', async (req, reply) => {
    const user = await getSessionUser(req)
    if (!user) {
      if (authOptional) return DEV_USER
      return reply.code(401).send({ error: 'unauthorized' })
    }
    return user
  })

  // ----- Đăng xuất -----
  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply)
    return { ok: true }
  })

  // ----- Quản lý 2FA (yêu cầu đã đăng nhập) -----
  // Bắt đầu cài đặt: sinh secret mới (chưa lưu là "đã bật"), trả secret + otpauth URI.
  app.post('/api/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const uid = req.user!.id
    if (uid === 0) return reply.code(400).send({ error: 'dev_user' })
    // Không cho setup lại khi 2FA đang bật — sẽ ghi đè secret khớp với
    // authenticator hiện tại và làm hỏng đăng nhập. Phải disable trước.
    if (req.user!.totpEnabled) {
      return reply.code(409).send({ error: 'already_enabled' })
    }
    const secret = generateTotpSecret()
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, uid))
    const account = req.user!.username || req.user!.email
    return { secret, otpauthUri: buildOtpauthUri(secret, account) }
  })

  // Bật 2FA: xác minh mã từ secret vừa setup rồi mới đặt totpEnabled=true.
  app.post('/api/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = enableSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const uid = req.user!.id
    if (uid === 0) return reply.code(400).send({ error: 'dev_user' })
    const rows = await db
      .select({ totpSecret: users.totpSecret })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1)
    const secret = rows[0]?.totpSecret
    // Chỉ chấp nhận secret đã lưu từ bước setup (không tin secret client gửi lên
    // ngoài để so khớp — dùng secret ở DB là nguồn tin cậy). So sánh timing-safe.
    if (!secret || !safeEqualStr(secret, parsed.data.secret)) {
      return reply.code(400).send({ error: 'setup_required' })
    }
    const matchedCounter = verifyTotpDetailed(secret, parsed.data.code)
    if (matchedCounter === -1) {
      return reply.code(401).send({ error: 'invalid_code' })
    }
    // Ghi counter đã dùng để không thể replay chính mã enable này ở bước login.
    await db
      .update(users)
      .set({ totpEnabled: true, totpLastCounter: matchedCounter })
      .where(eq(users.id, uid))
    return { ok: true }
  })

  // Tắt 2FA: yêu cầu nhập lại mật khẩu để xác nhận.
  app.post('/api/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = disableSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const uid = req.user!.id
    if (uid === 0) return reply.code(400).send({ error: 'dev_user' })
    const rows = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1)
    if (!(await verifyPassword(parsed.data.password, rows[0]?.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    await db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, uid))
    return { ok: true }
  })

  // Đổi mật khẩu (yêu cầu mật khẩu hiện tại).
  app.post('/api/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' })
    const uid = req.user!.id
    if (uid === 0) return reply.code(400).send({ error: 'dev_user' })
    const rows = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1)
    if (!(await verifyPassword(parsed.data.currentPassword, rows[0]?.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    const passwordHash = await hashPassword(parsed.data.newPassword)
    await db.update(users).set({ passwordHash }).where(eq(users.id, uid))
    return { ok: true }
  })
}
