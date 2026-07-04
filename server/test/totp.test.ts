import { describe, it, expect } from 'vitest'
import {
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
  verifyTotpDetailed,
  generateTotpSecret,
  buildOtpauthUri,
} from '../src/lib/totp'

describe('base32', () => {
  it('encode/decode round-trip', () => {
    const buf = Buffer.from('Hello TOTP world!')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })

  it('bỏ qua khoảng trắng, đệm và không phân biệt hoa thường', () => {
    const enc = base32Encode(Buffer.from([1, 2, 3, 4, 5]))
    const spaced = enc.toLowerCase().split('').join(' ') + '==='
    expect(base32Decode(spaced).equals(base32Decode(enc))).toBe(true)
  })
})

describe('TOTP RFC 6238', () => {
  // Vector chuẩn RFC 6238 (secret ASCII "12345678901234567890" = SHA1).
  const RFC_SECRET_B32 = base32Encode(Buffer.from('12345678901234567890'))

  it('khớp vector RFC tại T=59s -> 287082', () => {
    expect(generateTotp(RFC_SECRET_B32, 59 * 1000)).toBe('287082')
  })

  it('khớp vector RFC tại T=1111111109s -> 081804', () => {
    expect(generateTotp(RFC_SECRET_B32, 1111111109 * 1000)).toBe('081804')
  })

  it('verify chấp nhận mã hiện tại', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    expect(verifyTotp(secret, generateTotp(secret, now), 1, now)).toBe(true)
  })

  it('verify chấp nhận lệch ±1 bước (trôi đồng hồ)', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    const prev = generateTotp(secret, now - 30_000)
    const next = generateTotp(secret, now + 30_000)
    expect(verifyTotp(secret, prev, 1, now)).toBe(true)
    expect(verifyTotp(secret, next, 1, now)).toBe(true)
  })

  it('từ chối mã ngoài cửa sổ', () => {
    const secret = generateTotpSecret()
    const now = Date.now()
    const far = generateTotp(secret, now + 5 * 60_000)
    expect(verifyTotp(secret, far, 1, now)).toBe(false)
  })

  it('từ chối định dạng sai', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '')).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
    expect(verifyTotp(secret, '12345')).toBe(false)
  })

  it('verifyTotpDetailed trả counter khớp và -1 khi sai', () => {
    const secret = generateTotpSecret()
    const now = 1_700_000_000_000
    const counter = Math.floor(now / 1000 / 30)
    const code = generateTotp(secret, now)
    expect(verifyTotpDetailed(secret, code, { forTime: now })).toBe(counter)
    expect(verifyTotpDetailed(secret, '000000', { forTime: now })).toBe(-1)
  })

  it('chống replay: từ chối mã có counter <= afterCounter', () => {
    const secret = generateTotpSecret()
    const now = 1_700_000_000_000
    const counter = Math.floor(now / 1000 / 30)
    const code = generateTotp(secret, now)
    // Lần đầu chấp nhận
    expect(verifyTotpDetailed(secret, code, { forTime: now })).toBe(counter)
    // Sau khi đã dùng counter này -> từ chối cùng mã (replay)
    expect(
      verifyTotpDetailed(secret, code, { forTime: now, afterCounter: counter })
    ).toBe(-1)
    // Mã của bước kế tiếp (counter+1) vẫn được chấp nhận
    const next = generateTotp(secret, now + 30_000)
    expect(
      verifyTotpDetailed(secret, next, { forTime: now + 30_000, afterCounter: counter })
    ).toBe(counter + 1)
  })

  it('otpauth URI chứa secret và issuer', () => {
    const secret = generateTotpSecret()
    const uri = buildOtpauthUri(secret, 'admin', 'MyIssuer')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain(`secret=${secret}`)
    expect(uri).toContain('issuer=MyIssuer')
  })
})
