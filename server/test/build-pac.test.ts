import { describe, it, expect } from 'vitest'
import { buildPac, prefixToMask, cidrToBaseMask, type PacRuleRow } from '../src/lib/build-pac'

function rule(over: Partial<PacRuleRow>): PacRuleRow {
  return { kind: 'domain', pattern: 'example.com', proxyTarget: 'PROXY 127.0.0.1:18888', priority: 100, enabled: true, ...over }
}

describe('prefixToMask', () => {
  it('các prefix phổ biến', () => {
    expect(prefixToMask(8)).toBe('255.0.0.0')
    expect(prefixToMask(12)).toBe('255.240.0.0')
    expect(prefixToMask(16)).toBe('255.255.0.0')
    expect(prefixToMask(24)).toBe('255.255.255.0')
    expect(prefixToMask(32)).toBe('255.255.255.255')
    expect(prefixToMask(0)).toBe('0.0.0.0')
  })
})

describe('cidrToBaseMask', () => {
  it('tách base + mask', () => {
    expect(cidrToBaseMask('10.0.0.0/8')).toEqual({ base: '10.0.0.0', mask: '255.0.0.0' })
  })
  it('không có / -> /32', () => {
    expect(cidrToBaseMask('1.2.3.4')).toEqual({ base: '1.2.3.4', mask: '255.255.255.255' })
  })
})

describe('buildPac', () => {
  it('domain không có * -> sinh exact + wildcard', () => {
    const pac = buildPac([rule({ pattern: 'bitel.com.pe' })])
    expect(pac).toContain('shExpMatch(host, "bitel.com.pe") || shExpMatch(host, "*.bitel.com.pe")')
    expect(pac).toContain('return "PROXY 127.0.0.1:18888"')
  })

  it('domain có sẵn * -> dùng nguyên pattern', () => {
    const pac = buildPac([rule({ pattern: '*.intranet.itop' })])
    expect(pac).toContain('shExpMatch(host, "*.intranet.itop")')
    expect(pac).not.toContain('*.*.intranet.itop')
  })

  it('subnet -> isInNet base+mask', () => {
    const pac = buildPac([rule({ kind: 'subnet', pattern: '10.0.0.0/8' })])
    expect(pac).toContain('isInNet(host, "10.0.0.0", "255.0.0.0")')
  })

  it('luôn kết thúc bằng FindProxyForURL + DIRECT', () => {
    const pac = buildPac([])
    expect(pac).toContain('function FindProxyForURL(url, host)')
    expect(pac).toContain('return "DIRECT";')
  })

  it('bỏ rule disabled', () => {
    const pac = buildPac([rule({ pattern: 'on.com' }), rule({ pattern: 'off.com', enabled: false })])
    expect(pac).toContain('on.com')
    expect(pac).not.toContain('off.com')
  })

  it('sắp theo priority rồi domain trước subnet', () => {
    const pac = buildPac([
      rule({ kind: 'subnet', pattern: '10.0.0.0/8', priority: 100 }),
      rule({ kind: 'domain', pattern: 'a.com', priority: 100 }),
      rule({ kind: 'domain', pattern: 'z.com', priority: 50 }),
    ])
    const iZ = pac.indexOf('z.com')
    const iA = pac.indexOf('a.com')
    const iSub = pac.indexOf('isInNet')
    expect(iZ).toBeGreaterThan(-1)
    expect(iZ).toBeLessThan(iA) // priority 50 trước 100
    expect(iA).toBeLessThan(iSub) // domain trước subnet cùng priority
  })

  it('escape ký tự đặc biệt trong pattern/target (chống chèn JS)', () => {
    const pac = buildPac([rule({ pattern: 'a"b.com', proxyTarget: 'PROXY x";evil()//' })])
    expect(pac).toContain('"a\\"b.com"')
    expect(pac).toContain('"PROXY x\\";evil()//"')
  })
})
