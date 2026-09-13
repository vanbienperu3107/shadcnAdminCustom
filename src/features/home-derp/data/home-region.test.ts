import { describe, expect, it } from 'vitest'
import type { HomeDerpRow } from './home-derp-api'
import { newestHomeRegionByHost } from './home-region'

const row = (
  hostname: string,
  code: string | null,
  reportedAt: string,
  mac = 'aa'
): HomeDerpRow => ({
  mac,
  hostname,
  homeRegionId: null,
  homeRegionCode: code,
  controllerLatencyMs: null,
  reportedAt,
})

describe('newestHomeRegionByHost', () => {
  // Ca that 2026-09-12: API tra reportedAt GIAM dan; VOTAM-PC co dong moi (vpn4)
  // dung truoc dong 5 ngay tuoi (vpn6). Ban cu de dong cu nhat thang -> vpn6-vn.
  it('nhieu dong cung host -> lay dong reportedAt MOI NHAT, bat ke thu tu mang', () => {
    const rows = [
      row('VOTAM-PC', 'vpn4-lima', '2026-09-12T19:14:38Z', 'mac-new'),
      row('VOTAM-PC', 'vpn4-lima', '2026-09-08T00:00:00Z', 'mac-mid'),
      row('VOTAM-PC', 'vpn6-vn', '2026-09-07T12:00:00Z', 'mac-old'),
    ]
    expect(newestHomeRegionByHost(rows).get('votam-pc')).toBe('vpn4-lima')
    expect(newestHomeRegionByHost([...rows].reverse()).get('votam-pc')).toBe(
      'vpn4-lima'
    )
  })

  it('hostname duoc ha chu thuong + trim', () => {
    const m = newestHomeRegionByHost([
      row('  ITOP-THANHHN5 ', 'vpn4-lima', '2026-09-12T00:00:00Z'),
    ])
    expect(m.get('itop-thanhhn5')).toBe('vpn4-lima')
  })

  it('bo qua dong thieu homeRegionCode hoac hostname', () => {
    const m = newestHomeRegionByHost([
      row('votam-pc', null, '2026-09-12T23:00:00Z'),
      row('', 'vpn6-vn', '2026-09-12T23:00:00Z'),
      row('votam-pc', 'vpn4-lima', '2026-09-12T10:00:00Z'),
    ])
    expect(m.get('votam-pc')).toBe('vpn4-lima')
    expect(m.size).toBe(1)
  })

  it('reportedAt khong hop le khong duoc thang dong co thoi gian that', () => {
    const m = newestHomeRegionByHost([
      row('votam-pc', 'vpn6-vn', 'not-a-date'),
      row('votam-pc', 'vpn4-lima', '2026-09-01T00:00:00Z'),
    ])
    expect(m.get('votam-pc')).toBe('vpn4-lima')
  })

  it('mang rong -> map rong', () => {
    expect(newestHomeRegionByHost([]).size).toBe(0)
  })
})
