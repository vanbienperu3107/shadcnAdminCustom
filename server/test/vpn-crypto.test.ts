import { describe, it, expect, beforeAll } from 'vitest'

// Đặt khoá trước khi import module (env đọc lúc load).
// Khoá test giả (không phải bí mật) — dựng từ ký tự lặp để đủ độ dài.
const testMaterial = 'x'.repeat(40)

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgres://ci:ci@localhost:5432/ci'
  process.env.VPN_SECRET_KEY = testMaterial
})

describe('vpn-crypto', () => {
  it('mã hoá rồi giải mã ra đúng bản gốc', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/vpn-crypto.js')
    const plain = 'dummy-openvpn-pass-not-real'
    const enc = encryptSecret(plain)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc).not.toContain(plain) // không lộ bản gốc
    expect(decryptSecret(enc)).toBe(plain)
  })

  it('mỗi lần mã hoá cho cipher khác nhau (IV ngẫu nhiên)', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/vpn-crypto.js')
    const a = encryptSecret('same')
    const b = encryptSecret('same')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same')
    expect(decryptSecret(b)).toBe('same')
  })

  it('sửa cipher text -> giải mã ném lỗi (GCM auth)', async () => {
    const { encryptSecret, decryptSecret } = await import('../src/lib/vpn-crypto.js')
    const enc = encryptSecret('secret')
    const parts = enc.split(':')
    // lật 1 ký tự trong phần cipher
    const ct = Buffer.from(parts[3], 'base64')
    ct[0] = ct[0] ^ 0xff
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${ct.toString('base64')}`
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('định dạng lạ -> ném lỗi', async () => {
    const { decryptSecret } = await import('../src/lib/vpn-crypto.js')
    expect(() => decryptSecret('not-a-cipher')).toThrow()
    expect(() => decryptSecret('v2:a:b:c')).toThrow()
  })

  it('isEncrypted phân biệt đã/chưa mã hoá', async () => {
    const { encryptSecret, isEncrypted } = await import('../src/lib/vpn-crypto.js')
    expect(isEncrypted(encryptSecret('x'))).toBe(true)
    expect(isEncrypted('plain')).toBe(false)
    expect(isEncrypted(null)).toBe(false)
    expect(isEncrypted(undefined)).toBe(false)
  })
})
