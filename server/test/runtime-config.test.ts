import { describe, it, expect } from 'vitest'
import { resolveRuntimeConfig, RUNTIME_DEFAULTS, type NodeRuntimeRow } from '../src/lib/runtime-config'

describe('resolveRuntimeConfig', () => {
  it('không node, không global -> default y hệt .bat hardcode', () => {
    const c = resolveRuntimeConfig({}, null)
    expect(c).toEqual(RUNTIME_DEFAULTS)
    expect(c.always_use_derp).toBe(true)
    expect(c.peer_http_proxy).toBe('7655')
    expect(c.login_server).toBe('https://vpn2.hangocthanh.io.vn')
    expect(c.pac_server_port).toBe(7658)
  })

  it('global override lan_routes', () => {
    const c = resolveRuntimeConfig({ lan_routes: '10.0.0.0/8,192.168.0.0/16' }, null)
    expect(c.lan_routes).toBe('10.0.0.0/8,192.168.0.0/16')
  })

  it('per-node override thắng default (fix UDP: tắt always_use_derp)', () => {
    const node: NodeRuntimeRow = { mac: 'aa', alwaysUseDerp: false, mode: 'itop' }
    const c = resolveRuntimeConfig({}, node)
    expect(c.always_use_derp).toBe(false)
    expect(c.mode).toBe('itop')
    // field không set vẫn giữ default
    expect(c.peer_http_proxy).toBe('7655')
  })

  it('per-node thắng cả global', () => {
    const c = resolveRuntimeConfig({ lan_routes: '10.0.0.0/8' }, { mac: 'aa', lanRoutes: '172.16.0.0/12' })
    expect(c.lan_routes).toBe('172.16.0.0/12')
  })

  it('cột null/rỗng của node KHÔNG override (giữ default)', () => {
    const node: NodeRuntimeRow = { mac: 'aa', loginServer: null, socksAddr: '', advertiseRoutes: null }
    const c = resolveRuntimeConfig({}, node)
    expect(c.login_server).toBe(RUNTIME_DEFAULTS.login_server)
    expect(c.socks_addr).toBe(RUNTIME_DEFAULTS.socks_addr)
  })

  it('advertise_routes rỗng "" CÓ thể set (khác null) — cho phép xoá advertise', () => {
    const c = resolveRuntimeConfig({}, { mac: 'aa', advertiseRoutes: '' })
    expect(c.advertise_routes).toBe('')
  })

  it('số dạng chuỗi vẫn parse', () => {
    const c = resolveRuntimeConfig({}, { mac: 'aa', derpKeepaliveSecs: 40 as unknown as number, pacServerPort: 9000 })
    expect(c.derp_keepalive_secs).toBe(40)
    expect(c.pac_server_port).toBe(9000)
  })
})
