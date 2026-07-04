import { randomBytes } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'
import { isProd } from '../env.js'
import type { GoogleProfile, GoogleTokens } from './google.js'

export const SESSION_COOKIE = 'derp_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 ngày

export type SessionUser = {
  id: number
  email: string
  name: string | null
  picture: string | null
  username: string | null
  totpEnabled: boolean
}

function newId(): string {
  return randomBytes(24).toString('base64url')
}

function setSessionCookie(
  reply: FastifyReply,
  id: string,
  maxAgeMs: number = SESSION_TTL_MS
): void {
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: Math.floor(maxAgeMs / 1000),
  })
}

/** Upsert user theo google_sub, tạo session, lưu token Google vào DB, set cookie. */
export async function createSession(
  reply: FastifyReply,
  profile: GoogleProfile,
  tokens: GoogleTokens
): Promise<void> {
  const [user] = await db
    .insert(users)
    .values({
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: { email: profile.email, name: profile.name ?? null, picture: profile.picture ?? null },
    })
    .returning()

  const id = newId()
  const now = Date.now()
  await db.insert(sessions).values({
    id,
    userId: user.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token,
    tokenExpiry: new Date(now + (tokens.expires_in ?? 3600) * 1000),
    expiresAt: new Date(now + SESSION_TTL_MS),
  })

  setSessionCookie(reply, id)
}

/**
 * Tạo session cho user đã xác thực bằng username/password (không có token Google).
 * pending2fa=true khi user đã bật 2FA và mới chỉ qua bước mật khẩu — session
 * chưa hợp lệ cho tới khi promoteSession() sau khi nhập đúng mã TOTP.
 * Trả về session id (dùng làm pending token cho bước verify-2fa).
 */
export async function createSessionForUser(
  reply: FastifyReply,
  userId: number,
  opts: { pending2fa?: boolean } = {}
): Promise<string> {
  const id = newId()
  const now = Date.now()
  // Pending session sống ngắn (10 phút) — đủ để nhập TOTP, không để treo lâu.
  const ttlMs = opts.pending2fa ? 10 * 60 * 1000 : SESSION_TTL_MS
  await db.insert(sessions).values({
    id,
    userId,
    pending2fa: opts.pending2fa ?? false,
    expiresAt: new Date(now + ttlMs),
  })
  // Cookie maxAge khớp TTL server (pending = 10 phút) để client không giữ cookie chết.
  setSessionCookie(reply, id, ttlMs)
  return id
}

/**
 * Hoàn tất bước 2FA: gỡ cờ pending, gia hạn TTL đầy đủ. Trả false nếu session
 * không tồn tại / không ở trạng thái pending / đã hết hạn.
 */
export async function promoteSession(
  sessionId: string,
  reply: FastifyReply
): Promise<boolean> {
  const now = Date.now()
  const rows = await db
    .update(sessions)
    .set({
      pending2fa: false,
      expiresAt: new Date(now + SESSION_TTL_MS),
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.pending2fa, true),
        gt(sessions.expiresAt, new Date())
      )
    )
    .returning({ id: sessions.id })
  if (rows.length === 0) return false
  setSessionCookie(reply, sessionId)
  return true
}

/** Đọc session hiện tại từ cookie (hoặc null). */
export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (!sid) return null
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      picture: users.picture,
      username: users.username,
      totpEnabled: users.totpEnabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sid),
        eq(sessions.pending2fa, false),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1)
  return rows[0] ?? null
}

/**
 * Đọc thông tin cần thiết cho bước verify-2fa của một session ĐANG pending
 * (chưa hợp lệ với getSessionUser). Trả null nếu session không tồn tại / không
 * pending / đã hết hạn.
 */
export const MAX_MFA_ATTEMPTS = 5

export async function lookupPendingSession(sessionId: string): Promise<{
  userId: number
  totpSecret: string | null
  totpEnabled: boolean
  totpLastCounter: number | null
  mfaAttempts: number
} | null> {
  const rows = await db
    .select({
      userId: users.id,
      totpSecret: users.totpSecret,
      totpEnabled: users.totpEnabled,
      totpLastCounter: users.totpLastCounter,
      mfaAttempts: sessions.mfaAttempts,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.pending2fa, true),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1)
  return rows[0] ?? null
}

/** Ghi nhận 1 lần nhập sai mã 2FA; trả về tổng số lần sai sau khi tăng. */
export async function bumpMfaAttempts(sessionId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ mfaAttempts: sql`${sessions.mfaAttempts} + 1` })
    .where(eq(sessions.id, sessionId))
    .returning({ attempts: sessions.mfaAttempts })
  return rows[0]?.attempts ?? 0
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (sid) await db.delete(sessions).where(eq(sessions.id, sid))
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
