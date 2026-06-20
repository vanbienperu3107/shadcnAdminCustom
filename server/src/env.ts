import { existsSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

// Dev: nạp .env nếu có (prod/Docker lấy env từ compose nên không cần).
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* Node < 20.12 không có loadEnvFile — bỏ qua, dùng env hệ thống */
  }
}

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().default(8787),
  PUBLIC_URL: z.string().url().default('http://localhost:8787'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_SECRET: z.string().default('dev-insecure-change-me-please-32chars'),
  ALLOWED_EMAILS: z.string().default(''),
  SEED_DERP_YAML: z.string().optional(),
  EMBEDDED_HOSTNAME: z.string().default('vpn2.hangocthanh.io.vn'),
  EMBEDDED_IPV4: z.string().default('165.22.12.169'),
  CORS_ORIGIN: z.string().default(''),
  CLIENT_DIST: z.string().default(''),
  // 'true' = bỏ qua đăng nhập (CHỈ dev/local để xem UI khi chưa cấu hình Google).
  AUTH_OPTIONAL: z.string().default('false'),
  NODE_ENV: z.string().default('development'),
})

export const env = schema.parse(process.env)

/** Danh sách email được phép đăng nhập, normalize lowercase. */
export const allowedEmails = env.ALLOWED_EMAILS.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export const isProd = env.NODE_ENV === 'production'
export const googleEnabled = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const authOptional = env.AUTH_OPTIONAL === 'true'
