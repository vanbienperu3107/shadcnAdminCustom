import { describe, it, expect } from 'vitest'
import {
  PREAUTH_TTL_MS,
  adoptStatus,
  deviceTokenMatches,
  enrollDecision,
  hashDeviceToken,
  maskSalt,
  newDeviceToken,
  normalizeMac,
  normalizeSalt,
  preAuthKeyExpiration,
  type EnrollRow,
} from '../src/lib/enrollment.js'

describe('normalizeSalt', () => {
  // MIRROR of TestNormalizeSerial in cmd/tailscaled/hwid_test.go. The client
  // hashes this exact string into its machine key; if the two normalizations
  // ever diverge the device silently gets a NEW identity and loses its IP.
  const cases: [string, string][] = [
    ['  wd-wcc4e5pz ', 'WD-WCC4E5PZ'],
    ['WD-WCC4E5PZ', 'WD-WCC4E5PZ'],
    ['s n  1234', 'S N 1234'],
    ['\tabc\r\n123\t', 'ABC 123'],
    ['nvme_serial_0001', 'NVME_SERIAL_0001'],
    ['', ''],
    ['   \t ', ''],
  ]
  it.each(cases)('normalizeSalt(%j) -> %j', (input, want) => {
    expect(normalizeSalt(input)).toBe(want)
  })

  it('is idempotent', () => {
    const once = normalizeSalt('  a  b ')
    expect(normalizeSalt(once)).toBe(once)
  })
})

describe('normalizeMac', () => {
  it('lowercases and trims', () => {
    expect(normalizeMac('  F8:CF:00:11  ')).toBe('f8:cf:00:11')
  })
})

describe('preAuthKeyExpiration (zero-time trap regression)', () => {
  // headscale treats a zero-time expiration as ALREADY EXPIRED, so a mint
  // request that omits `expiration` yields a key that is dead on arrival.
  // Every mint must therefore carry an explicit, future expiration.
  const now = new Date('2026-07-09T12:00:00.000Z')

  it('is a non-empty ISO timestamp', () => {
    const exp = preAuthKeyExpiration(now)
    expect(exp).toBeTruthy()
    expect(Number.isNaN(Date.parse(exp))).toBe(false)
  })

  it('is strictly in the future (never the zero time)', () => {
    const exp = Date.parse(preAuthKeyExpiration(now))
    expect(exp).toBeGreaterThan(now.getTime())
    expect(exp).not.toBe(0)
  })

  it('defaults to a 10-minute TTL', () => {
    expect(Date.parse(preAuthKeyExpiration(now)) - now.getTime()).toBe(
      PREAUTH_TTL_MS
    )
    expect(PREAUTH_TTL_MS).toBe(10 * 60 * 1000)
  })
})

describe('device token hashing', () => {
  it('never stores the token itself', () => {
    const t = newDeviceToken()
    const h = hashDeviceToken(t)
    expect(h).toHaveLength(64) // sha256 hex
    expect(h).not.toContain(t)
  })

  it('matches the right token and rejects the wrong one', () => {
    const t = newDeviceToken()
    const h = hashDeviceToken(t)
    expect(deviceTokenMatches(t, h)).toBe(true)
    expect(deviceTokenMatches(newDeviceToken(), h)).toBe(false)
  })

  it('rejects empty inputs (no vacuous match)', () => {
    expect(deviceTokenMatches('', hashDeviceToken('x'))).toBe(false)
    expect(deviceTokenMatches('x', '')).toBe(false)
    expect(deviceTokenMatches('', '')).toBe(false)
  })

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(deviceTokenMatches('x', 'not-hex')).toBe(false)
  })

  it('two tokens are different', () => {
    expect(newDeviceToken()).not.toBe(newDeviceToken())
  })
})

describe('enrollDecision (state machine, plan §4.2)', () => {
  const approvedNoToken: EnrollRow = { status: 'approved', deviceTokenHash: null }

  it('no row -> create a pending row (202)', () => {
    expect(enrollDecision(null, '')).toEqual({ kind: 'create-pending' })
  })

  it('pending row -> keep waiting (202), whatever the client sends', () => {
    const row: EnrollRow = { status: 'pending', deviceTokenHash: null }
    expect(enrollDecision(row, '')).toEqual({ kind: 'pending' })
    expect(enrollDecision(row, 'anything')).toEqual({ kind: 'pending' })
  })

  it('revoked -> denied, even with a valid token', () => {
    const t = newDeviceToken()
    const row: EnrollRow = { status: 'revoked', deviceTokenHash: hashDeviceToken(t) }
    expect(enrollDecision(row, t)).toEqual({ kind: 'denied', reason: 'revoked' })
  })

  it('approved + no token yet -> issue key AND mint a device token (first-enroll-wins)', () => {
    expect(enrollDecision(approvedNoToken, '')).toEqual({
      kind: 'issue',
      mintToken: true,
    })
  })

  it('approved + matching token -> issue key, do NOT mint a second token', () => {
    const t = newDeviceToken()
    const row: EnrollRow = { status: 'approved', deviceTokenHash: hashDeviceToken(t) }
    expect(enrollDecision(row, t)).toEqual({ kind: 'issue', mintToken: false })
  })

  it('approved + token already claimed but none supplied -> denied', () => {
    const row: EnrollRow = {
      status: 'approved',
      deviceTokenHash: hashDeviceToken(newDeviceToken()),
    }
    expect(enrollDecision(row, '')).toEqual({
      kind: 'denied',
      reason: 'token_required',
    })
  })

  it('approved + wrong token -> denied (knowing mac+salt is not enough)', () => {
    const row: EnrollRow = {
      status: 'approved',
      deviceTokenHash: hashDeviceToken(newDeviceToken()),
    }
    expect(enrollDecision(row, newDeviceToken())).toEqual({
      kind: 'denied',
      reason: 'token_mismatch',
    })
  })
})

describe('adoptStatus (auto-adopt máy đã login OIDC)', () => {
  it('máy chưa có bản ghi -> approved', () => {
    expect(adoptStatus(null)).toBe('approved')
  })
  it('pending -> approved (adopt tự duyệt)', () => {
    expect(adoptStatus('pending')).toBe('approved')
  })
  it('approved -> approved (giữ nguyên)', () => {
    expect(adoptStatus('approved')).toBe('approved')
  })
  it('revoked -> revoked: KHÔNG bao giờ dựng dậy dòng admin đã cấm', () => {
    // Đây là bất biến an toàn quan trọng nhất của auto-adopt: một máy bị admin
    // thu hồi không được tự vào lại chỉ vì nó login OIDC lần nữa.
    expect(adoptStatus('revoked')).toBe('revoked')
  })
})

describe('maskSalt', () => {
  it('masks the middle of a serial', () => {
    expect(maskSalt('WD-WCC4E5PZ')).toBe('WD••••PZ')
  })
  it('fully masks a short serial', () => {
    expect(maskSalt('AB')).toBe('••••')
    expect(maskSalt('')).toBe('••••')
  })
  it('never returns the full serial', () => {
    const s = 'NVME_SERIAL_0001'
    expect(maskSalt(s)).not.toBe(s)
  })
})
