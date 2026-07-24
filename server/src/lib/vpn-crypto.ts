import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { env } from '../env.js'

/**
 * Mã hoá đối xứng cho bí mật của VPN gateway (mật khẩu OpenVPN) trước khi lưu DB.
 * AES-256-GCM (có xác thực toàn vẹn — sửa cipher text sẽ ném lỗi khi giải mã).
 *
 * Khoá 32 byte = SHA-256(VPN_SECRET_KEY hoặc SESSION_SECRET). VPN_SECRET_KEY nên
 * đặt ở prod và tách kênh backup khỏi DATABASE_URL: rò riêng DB không giải được
 * mật khẩu VPN. Chỉ route agent (Bearer token) mới gọi decryptSecret.
 *
 * Định dạng chuỗi lưu DB: `v1:<ivB64>:<tagB64>:<cipherB64>`.
 */

function key(): Buffer {
  const material = env.VPN_SECRET_KEY || env.SESSION_SECRET || 'dev-insecure-vpn-key'
  return createHash('sha256').update(material).digest() // 32 byte
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12) // GCM nonce 96-bit
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`
}

export function decryptSecret(enc: string): string {
  const parts = enc.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('vpn-crypto: định dạng cipher không hỗ trợ')
  }
  const [, ivB, tagB, ctB] = parts
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([
    d.update(Buffer.from(ctB, 'base64')),
    d.final(),
  ]).toString('utf8')
}

/** True nếu chuỗi trông như đã mã hoá bởi hàm trên (tránh mã hoá 2 lần). */
export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.startsWith('v1:')
}
