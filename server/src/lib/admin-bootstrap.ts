import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { env } from '../env.js'
import { hashPassword } from './password.js'

/**
 * Tạo tài khoản admin nội bộ (username/password) từ biến môi trường ADMIN_USERNAME
 * + ADMIN_PASSWORD lúc khởi động. Idempotent: chỉ tạo nếu username CHƯA tồn tại —
 * không bao giờ ghi đè mật khẩu / 2FA mà admin đã tự đổi sau này.
 *
 * Trả về true nếu vừa tạo mới (để log), false nếu bỏ qua.
 */
export async function bootstrapAdmin(): Promise<boolean> {
  // login handler chuẩn hóa username về lowercase — lưu tương ứng để khớp.
  const username = env.ADMIN_USERNAME.trim().toLowerCase()
  const password = env.ADMIN_PASSWORD
  if (!username || !password) return false

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (existing.length > 0) return false

  const email = env.ADMIN_EMAIL.trim().toLowerCase() || `${username}@local`
  const passwordHash = await hashPassword(password)
  await db.insert(users).values({
    username,
    passwordHash,
    email,
    name: username,
  })
  return true
}
