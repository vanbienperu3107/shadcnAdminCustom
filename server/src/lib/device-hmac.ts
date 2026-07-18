import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'
import { normalizeSalt } from './enrollment.js'

/**
 * Định danh thiết bị theo salt (plan device_id).
 *
 * `salt` = serial ổ cứng đã chuẩn hoá — CŨNG CHÍNH LÀ seed sinh private machine
 * key phía client (cmd/tailscaled/hwid.go: seed = "v1|" + salt). Vì vậy salt là
 * dữ liệu CỰC nhạy: KHÔNG BAO GIỜ lưu thô. Ta chỉ lưu `salt_hmac` = HMAC-SHA256(
 * salt, PEPPER) làm khoá tra cứu. HMAC (không phải sha256 trần) + PEPPER là secret
 * server-side ⇒ lộ DB đơn thuần KHÔNG đảo ngược được salt (serial ổ cứng có định
 * dạng hãng, entropy thấp — hash trần brute-force offline được).
 */

/** Băm salt để lưu/tra cứu. Trả null nếu PEPPER chưa cấu hình hoặc salt rỗng. */
export function hmacSalt(rawSalt: string): string | null {
  if (!env.PEPPER) return null
  const salt = normalizeSalt(rawSalt)
  if (!salt) return null
  return createHmac('sha256', env.PEPPER).update(salt, 'utf8').digest('hex')
}

/** So khớp salt_hmac hằng-thời-gian (chống timing oracle trên endpoint public). */
export function saltHmacMatches(rawSalt: string, storedHmac: string): boolean {
  const computed = hmacSalt(rawSalt)
  if (!computed || !storedHmac) return false
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(storedHmac, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/** PEPPER đã cấu hình chưa — định danh theo salt chỉ hoạt động khi có. */
export function saltIdentityEnabled(): boolean {
  return !!env.PEPPER
}
