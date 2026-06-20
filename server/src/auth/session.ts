import { randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
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
}

function newId(): string {
  return randomBytes(24).toString('base64url')
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

  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS / 1000,
  })
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
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return rows[0] ?? null
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sid = req.cookies?.[SESSION_COOKIE]
  if (sid) await db.delete(sessions).where(eq(sessions.id, sid))
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}
