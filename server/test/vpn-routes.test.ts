import { describe, expect, it } from 'vitest'
import {
  MIN_PREFIX,
  advertiseRoutesFromDomains,
  advertiseRoutesString,
  decideRoute,
  isIpv4,
  isIpv4Cidr,
} from '../src/lib/vpn-routes.js'

const row = (domain: string, enabled = true) => ({ domain, enabled })

describe('isIpv4 / isIpv4Cidr', () => {
  it('phan biet IP voi ten mien', () => {
    expect(isIpv4('10.121.124.155')).toBe(true)
    expect(isIpv4('jump.bitel.com.pe')).toBe(false)
    expect(isIpv4('10.121.124')).toBe(false)
    expect(isIpv4('10.121.124.999')).toBe(false)
  })

  it('nhan CIDR hop le', () => {
    expect(isIpv4Cidr('10.121.124.0/24')).toBe(true)
    expect(isIpv4Cidr('10.121.124.155/32')).toBe(true)
    expect(isIpv4Cidr('10.121.124.0/33')).toBe(false)
    expect(isIpv4Cidr('10.121.124.0/24/8')).toBe(false)
  })
})

describe('decideRoute', () => {
  it('IP tran thanh /32', () => {
    expect(decideRoute('10.121.124.155')).toEqual({
      cidr: '10.121.124.155/32',
      ok: true,
    })
  })

  it('ten mien khong thanh route (chi vao PAC)', () => {
    expect(decideRoute('jump.bitel.com.pe')).toEqual({
      input: 'jump.bitel.com.pe',
      ok: false,
      reason: 'not-ip',
    })
  })

  it('CIDR du hep thi nhan', () => {
    expect(decideRoute('10.121.124.0/24')).toEqual({
      cidr: '10.121.124.0/24',
      ok: true,
    })
  })

  // Bai hoc su co 2026-08-09: gateway quang ba /16 trong khi tun0 chi phu ~42
  // prefix roi rac -> gianh primary la chan het phan con lai (10.121.20.x web
  // noi bo, 10.121.13.x remote DC). Chan tu day, khong de lap lai.
  it('TU CHOI prefix rong hon MIN_PREFIX', () => {
    expect(decideRoute('10.121.0.0/16')).toEqual({
      input: '10.121.0.0/16',
      ok: false,
      reason: 'too-broad',
    })
    expect(decideRoute('10.0.0.0/8').ok).toBe(false)
    expect(MIN_PREFIX).toBe(24)
  })
})

describe('advertiseRoutesFromDomains', () => {
  it('chi lay muc dang BAT', () => {
    const rows = [row('10.121.124.155'), row('10.121.124.200', false)]
    expect(advertiseRoutesFromDomains(rows)).toEqual(['10.121.124.155/32'])
  })

  it('bo qua ten mien, giu IP — giong du lieu that tren dashboard', () => {
    const rows = [row('jump.bitel.com.pe', false), row('10.121.124.155')]
    expect(advertiseRoutesString(rows)).toBe('10.121.124.155/32')
  })

  it('khong lap lai cung mot CIDR', () => {
    const rows = [row('10.121.124.155'), row('10.121.124.155/32')]
    expect(advertiseRoutesFromDomains(rows)).toEqual(['10.121.124.155/32'])
  })

  it('tat het thi tra chuoi rong (gateway rut advertise)', () => {
    expect(advertiseRoutesString([row('10.121.124.155', false)])).toBe('')
  })

  it('prefix qua rong bi loai khoi ket qua', () => {
    const rows = [row('10.121.0.0/16'), row('10.121.124.155')]
    expect(advertiseRoutesFromDomains(rows)).toEqual(['10.121.124.155/32'])
  })
})
