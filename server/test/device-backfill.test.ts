import { describe, it, expect } from 'vitest'
import { planBackfill, type EnrollRow } from '../src/lib/device-backfill.js'
import { hmacSalt, saltHmacMatches, saltIdentityEnabled } from '../src/lib/device-hmac.js'

// Helper: dựng nhanh 1 dòng device_enrollment.
function row(p: Partial<EnrollRow>): EnrollRow {
  return {
    mac: null,
    salt: 'WD-X',
    status: 'approved',
    hostname: null,
    pinnedIpv4: null,
    note: null,
    ...p,
  }
}

describe('planBackfill — hợp nhất theo salt (fix token_mismatch)', () => {
  it('2 MAC cùng salt → 1 device, 2 mac (chính là ca VOTAM-PC đổi card)', () => {
    const plans = planBackfill([
      row({ mac: 'f8:cf:52:6f:84:70', salt: 'WD-VOTAM' }),
      row({ mac: 'a4:c3:f0:11:22:33', salt: 'WD-VOTAM' }),
    ])
    expect(plans).toHaveLength(1)
    expect(plans[0].macs.sort()).toEqual(['a4:c3:f0:11:22:33', 'f8:cf:52:6f:84:70'])
    expect(plans[0].status).toBe('approved')
  })

  it('MAC hoa-thường → chuẩn hoá về 1 (không đếm đúp)', () => {
    const plans = planBackfill([
      row({ mac: 'F8:CF:52:6F:84:70', salt: 'S' }),
      row({ mac: 'f8:cf:52:6f:84:70', salt: 'S' }),
    ])
    expect(plans[0].macs).toEqual(['f8:cf:52:6f:84:70'])
  })

  it('CÓ revoked → device revoked-về-pending (không dựng máy admin đã cấm)', () => {
    const plans = planBackfill([
      row({ salt: 'S', status: 'approved' }),
      row({ salt: 'S', status: 'revoked' }),
    ])
    expect(plans[0].status).toBe('pending')
  })

  it('chỉ pending → pending', () => {
    expect(planBackfill([row({ salt: 'S', status: 'pending' })])[0].status).toBe('pending')
  })

  it('salt rỗng / null → bỏ qua', () => {
    expect(planBackfill([row({ salt: '' }), row({ salt: '   ' }), row({ salt: null })])).toHaveLength(0)
  })

  it('salt khác nhau → device khác nhau', () => {
    const plans = planBackfill([row({ salt: 'A' }), row({ salt: 'B' })])
    expect(plans).toHaveLength(2)
  })

  it('hostname/ip/note lấy dòng đầu có giá trị', () => {
    const plans = planBackfill([
      row({ salt: 'S', hostname: null, pinnedIpv4: null }),
      row({ salt: 'S', hostname: 'itop', pinnedIpv4: '100.64.0.19', note: 'máy A' }),
    ])
    expect(plans[0].hostname).toBe('itop')
    expect(plans[0].staticIpv4).toBe('100.64.0.19')
    expect(plans[0].note).toBe('máy A')
  })
})

describe('hmacSalt — an toàn khi PEPPER chưa cấu hình (mặc định CI)', () => {
  it('PEPPER trống → hmacSalt null, saltIdentity tắt', () => {
    // CI không set PEPPER (env default '') ⇒ định danh theo salt tạm nghỉ,
    // KHÔNG rơi về hash yếu/không pepper.
    expect(saltIdentityEnabled()).toBe(false)
    expect(hmacSalt('WD-X')).toBeNull()
    expect(saltHmacMatches('WD-X', 'not-a-real-hmac')).toBe(false)
  })
})
