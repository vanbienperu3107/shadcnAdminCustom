import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP (RFC 6238) + base32 (RFC 4648) tự cài bằng Node crypto — không thêm
 * dependency. Tương thích Google Authenticator / Authy / 1Password (HMAC-SHA1,
 * 6 chữ số, chu kỳ 30s).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

/** Mã hóa buffer sang base32 không đệm '=' (dùng cho secret hiển thị cho user). */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return out
}

/** Giải mã base32 (bỏ qua khoảng trắng và đệm, không phân biệt hoa thường). */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('base32 không hợp lệ')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** Sinh secret TOTP ngẫu nhiên (20 byte = 160 bit), trả dạng base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Sinh mã TOTP cho 1 counter (mặc định = thời điểm hiện tại). */
export function generateTotp(
  secretBase32: string,
  forTime: number = Date.now()
): string {
  const counter = Math.floor(forTime / 1000 / STEP_SECONDS)
  const key = base32Decode(secretBase32)
  const msg = Buffer.alloc(8)
  // ghi counter 64-bit big-endian (dùng BigInt để an toàn > 2^32)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const otp = binary % 10 ** DIGITS
  return otp.toString().padStart(DIGITS, '0')
}

/** Counter (bước 30s) tương ứng một thời điểm. */
function counterFor(forTime: number): number {
  return Math.floor(forTime / 1000 / STEP_SECONDS)
}

/**
 * Xác minh chi tiết: trả về counter (bước) của mã khớp, hoặc -1 nếu không khớp.
 * `afterCounter` (chống replay): chỉ chấp nhận mã có counter > afterCounter —
 * caller lưu counter đã dùng để chặn dùng lại cùng một mã.
 */
export function verifyTotpDetailed(
  secretBase32: string,
  token: string,
  opts: { window?: number; forTime?: number; afterCounter?: number } = {}
): number {
  const window = opts.window ?? 1
  const forTime = opts.forTime ?? Date.now()
  const afterCounter = opts.afterCounter ?? -1
  const clean = (token ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return -1
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const t = forTime + errorWindow * STEP_SECONDS * 1000
    const counter = counterFor(t)
    if (counter <= afterCounter) continue // đã dùng rồi -> bỏ qua (chống replay)
    const candidate = generateTotp(secretBase32, t)
    const a = Buffer.from(candidate)
    const b = Buffer.from(clean)
    if (a.length === b.length && timingSafeEqual(a, b)) return counter
  }
  return -1
}

/**
 * Xác minh mã người dùng nhập, chấp nhận lệch ±`window` bước (mặc định 1 = ±30s)
 * để bù trôi đồng hồ. So sánh timing-safe.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  window = 1,
  forTime: number = Date.now()
): boolean {
  return verifyTotpDetailed(secretBase32, token, { window, forTime }) !== -1
}

/** URI `otpauth://` để nạp vào app authenticator (hoặc render QR). */
export function buildOtpauthUri(
  secretBase32: string,
  account: string,
  issuer = 'Headscale Admin'
): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
