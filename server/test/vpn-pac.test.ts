import { describe, it, expect } from 'vitest'
import {
  vpnDomainsToPacRows,
  type VpnDomainLite,
  type VpnGwLite,
} from '../src/lib/vpn-pac'
import { buildPac } from '../src/lib/build-pac'

const gw = (over: Partial<VpnGwLite>): VpnGwLite => ({
  id: 1,
  tailnetIp: '100.64.0.9',
  proxyPort: 8888,
  enabled: true,
  ...over,
})
const dom = (over: Partial<VpnDomainLite>): VpnDomainLite => ({
  gatewayId: 1,
  domain: 'jump.bitel.com.pe',
  enabled: true,
  priority: 10,
  ...over,
})

describe('vpnDomainsToPacRows', () => {
  it('dựng target PROXY từ tailnet_ip:proxy_port của gateway', () => {
    const rows = vpnDomainsToPacRows([dom({})], [gw({})])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'domain',
      pattern: 'jump.bitel.com.pe',
      proxyTarget: 'PROXY 100.64.0.9:8888',
      priority: 10,
      enabled: true,
    })
  })

  it('bỏ domain disabled', () => {
    expect(vpnDomainsToPacRows([dom({ enabled: false })], [gw({})])).toHaveLength(0)
  })

  it('bỏ domain của gateway disabled', () => {
    expect(vpnDomainsToPacRows([dom({})], [gw({ enabled: false })])).toHaveLength(0)
  })

  it('bỏ domain nếu gateway chưa có tailnet_ip', () => {
    expect(vpnDomainsToPacRows([dom({})], [gw({ tailnetIp: null })])).toHaveLength(0)
  })

  it('bỏ domain nếu không tìm thấy gateway', () => {
    expect(vpnDomainsToPacRows([dom({ gatewayId: 999 })], [gw({})])).toHaveLength(0)
  })

  it('port tuỳ chỉnh phản ánh vào target', () => {
    const rows = vpnDomainsToPacRows([dom({})], [gw({ proxyPort: 7655 })])
    expect(rows[0].proxyTarget).toBe('PROXY 100.64.0.9:7655')
  })

  it('gộp trước pac_rules -> dòng VPN đứng trước *.bitel.com.pe chung', () => {
    const vpnRows = vpnDomainsToPacRows([dom({ priority: 10 })], [gw({})])
    const pacRule = {
      kind: 'domain' as const,
      pattern: 'bitel.com.pe',
      proxyTarget: 'PROXY 127.0.0.1:8888',
      priority: 100,
      enabled: true,
    }
    const pac = buildPac([...vpnRows, pacRule])
    const iVpn = pac.indexOf('100.64.0.9:8888')
    const iRule = pac.indexOf('127.0.0.1:8888')
    expect(iVpn).toBeGreaterThan(-1)
    expect(iRule).toBeGreaterThan(-1)
    // jump.bitel.com.pe (VPN) phải xuất hiện TRƯỚC rule *.bitel.com.pe chung.
    expect(iVpn).toBeLessThan(iRule)
  })
})
