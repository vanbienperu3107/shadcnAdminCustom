import { env } from '../env.js'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export const REDIRECT_URI = `${env.PUBLIC_URL.replace(/\/$/, '')}/api/auth/google/callback`

export type GoogleTokens = {
  access_token: string
  refresh_token?: string
  id_token: string
  expires_in: number
}

export type GoogleProfile = {
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
}

/** URL chuyển hướng người dùng sang Google để đăng nhập. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/** Đổi authorization code lấy token (server-to-server, dùng client secret qua TLS). */
export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${text}`)
  }
  return (await res.json()) as GoogleTokens
}

/**
 * Giải mã payload của id_token (JWT). KHÔNG cần verify chữ ký vì token vừa nhận
 * TRỰC TIẾP từ token endpoint của Google qua TLS bằng client_secret của ta
 * (luồng authorization-code → token được tin cậy).
 */
export function decodeIdToken(idToken: string): GoogleProfile {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('id_token không hợp lệ')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  return {
    sub: payload.sub,
    email: String(payload.email ?? '').toLowerCase(),
    email_verified: !!payload.email_verified,
    name: payload.name,
    picture: payload.picture,
  }
}
