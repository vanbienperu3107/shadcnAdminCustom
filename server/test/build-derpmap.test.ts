import { describe, it, expect } from 'vitest'
import { buildDerpMap, scoreFromPriority, type DerpServerRow } from '../src/lib/build-derpmap'

function row(over: Partial<DerpServerRow>): DerpServerRow {
  return {
    regionId: 1000,
    code: 'vpn3-vn',
    name: 'VPN3 Vietnam',
    nodeName: 'vpn3-vn-1',
    hostname: 'vpn3.hangocthanh.io.vn',
    ipv4: '64.176.23.196',
    ipv6: null,
    derpPort: 443,
    stunPort: 3478,
    canPort80: false,
    stunOnly: false,
    latitude: null,
    longitude: null,
    enabled: true,
    paused: false,
    embedded: false,
    priority: 100,
    ...over,
  }
}

describe('buildDerpMap', () => {
  it('node bình thường: bỏ port mặc định, omitDefaultRegions=true', () => {
    const map = buildDerpMap([row({})])
    expect(map.omitDefaultRegions).toBe(true)
    expect(map.Regions['1000']).toEqual({
      RegionID: 1000,
      RegionCode: 'vpn3-vn',
      RegionName: 'VPN3 Vietnam',
      Nodes: [{ Name: 'vpn3-vn-1', RegionID: 1000, HostName: 'vpn3.hangocthanh.io.vn', IPv4: '64.176.23.196' }],
    })
    expect(map.HomeParams).toBeUndefined() // priority 100 -> score 1 -> bỏ
  })

  it('loại node disabled / paused / embedded', () => {
    const map = buildDerpMap([
      row({ regionId: 1000, code: 'a', nodeName: 'a' }),
      row({ regionId: 1001, code: 'b', nodeName: 'b', enabled: false }),
      row({ regionId: 1002, code: 'c', nodeName: 'c', paused: true }),
      row({ regionId: 999, code: 'emb', nodeName: 'emb', embedded: true }),
    ])
    expect(Object.keys(map.Regions)).toEqual(['1000'])
  })

  it('port khác mặc định và STUN -1 được emit', () => {
    const map = buildDerpMap([row({ derpPort: 8443, stunPort: -1, canPort80: true, stunOnly: true })])
    const node = map.Regions['1000'].Nodes[0]
    expect(node.DERPPort).toBe(8443)
    expect(node.STUNPort).toBe(-1)
    expect(node.CanPort80).toBe(true)
    expect(node.STUNOnly).toBe(true)
  })

  it('priority -> HomeParams.RegionScore (chỉ khi score != 1)', () => {
    const map = buildDerpMap([
      row({ regionId: 1000, code: 'a', nodeName: 'a', priority: 50 }), // score 0.5
      row({ regionId: 1001, code: 'b', nodeName: 'b', priority: 100 }), // score 1 -> bỏ
      row({ regionId: 1002, code: 'c', nodeName: 'c', priority: 200 }), // score 2
    ])
    expect(map.HomeParams?.RegionScore).toEqual({ '1000': 0.5, '1002': 2 })
  })

  it('scoreFromPriority clamp & mapping', () => {
    expect(scoreFromPriority(100)).toBe(1)
    expect(scoreFromPriority(50)).toBe(0.5)
    expect(scoreFromPriority(0)).toBe(1) // 0 -> mặc định 100
    expect(scoreFromPriority(5000)).toBe(10) // clamp 1000
  })

  it('JSON serialize đúng key casing', () => {
    const json = JSON.stringify(buildDerpMap([row({ priority: 50 })]))
    expect(json).toContain('"omitDefaultRegions":true')
    expect(json).toContain('"HomeParams"')
    expect(json).toContain('"RegionScore"')
    expect(json).toContain('"Regions"')
  })
})
