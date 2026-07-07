import { describe, it, expect } from 'vitest'
import { buildTaildriveGrants } from '../src/lib/taildrive-policy'

describe('buildTaildriveGrants', () => {
  const macIp = new Map([
    ['owner-mac', '100.64.0.1'],
    ['grantee-mac', '100.64.0.2'],
    ['grantee2-mac', '100.64.0.3'],
  ])

  it('sinh nodeAttrs owner+grantee và grant drive cho 1 quyền enabled', () => {
    const shares = [{ id: 1, ownerMac: 'owner-mac', shareName: 'dulieu', enabled: true }]
    const access = [
      { shareId: 1, granteeMac: 'grantee-mac', access: 'rw', enabled: true },
    ]
    const { nodeAttrs, grants } = buildTaildriveGrants(shares, access, macIp)

    expect(nodeAttrs).toEqual([
      { target: ['100.64.0.1/32'], attr: ['drive:share'] },
      { target: ['100.64.0.2/32'], attr: ['drive:access'] },
    ])
    // CHỈ "tailscale.com/cap/drive" — "drive-sharer" là companion cap
    // headscale tự sinh phía server (xem comment trong taildrive-policy.ts);
    // admin tự khai sẽ bị headscale từ chối cả request (400).
    expect(grants).toEqual([
      {
        src: ['100.64.0.2/32'],
        dst: ['100.64.0.1/32'],
        app: { 'tailscale.com/cap/drive': [{ shares: ['dulieu'], access: 'rw' }] },
      },
    ])
  })

  it('bỏ qua share/access đã tắt (enabled=false)', () => {
    const shares = [{ id: 1, ownerMac: 'owner-mac', shareName: 'dulieu', enabled: false }]
    const access = [{ shareId: 1, granteeMac: 'grantee-mac', access: 'rw', enabled: true }]
    const { nodeAttrs, grants } = buildTaildriveGrants(shares, access, macIp)
    expect(nodeAttrs).toEqual([])
    expect(grants).toEqual([])
  })

  it('bỏ qua khi chưa biết IP tailnet của owner hoặc grantee', () => {
    const shares = [{ id: 1, ownerMac: 'unknown-mac', shareName: 'dulieu', enabled: true }]
    const access = [{ shareId: 1, granteeMac: 'grantee-mac', access: 'rw', enabled: true }]
    const { nodeAttrs, grants } = buildTaildriveGrants(shares, access, macIp)
    expect(nodeAttrs).toEqual([])
    expect(grants).toEqual([])
  })

  it('grantee truy cập nhiều share của cùng 1 owner -> 1 grant drive riêng mỗi share, không có drive-sharer nào', () => {
    const shares = [
      { id: 1, ownerMac: 'owner-mac', shareName: 'dulieu', enabled: true },
      { id: 2, ownerMac: 'owner-mac', shareName: 'backup', enabled: true },
    ]
    const access = [
      { shareId: 1, granteeMac: 'grantee-mac', access: 'rw', enabled: true },
      { shareId: 2, granteeMac: 'grantee-mac', access: 'ro', enabled: true },
    ]
    const { grants } = buildTaildriveGrants(shares, access, macIp)
    expect(grants.every((g) => !('tailscale.com/cap/drive-sharer' in g.app))).toBe(true)
    const driveGrants = grants.filter((g) => 'tailscale.com/cap/drive' in g.app)
    expect(driveGrants).toHaveLength(2)
  })

  it('access khác "ro" (kể cả rỗng/lạ) mặc định thành "rw"', () => {
    const shares = [{ id: 1, ownerMac: 'owner-mac', shareName: 'dulieu', enabled: true }]
    const access = [{ shareId: 1, granteeMac: 'grantee-mac', access: 'garbage', enabled: true }]
    const { grants } = buildTaildriveGrants(shares, access, macIp)
    const driveGrant = grants.find((g) => 'tailscale.com/cap/drive' in g.app)
    expect((driveGrant!.app['tailscale.com/cap/drive'] as Array<{ access: string }>)[0].access).toBe('rw')
  })

  it('nhiều grantee cho cùng 1 owner -> nodeAttrs gom vào 1 entry drive:share', () => {
    const shares = [{ id: 1, ownerMac: 'owner-mac', shareName: 'dulieu', enabled: true }]
    const access = [
      { shareId: 1, granteeMac: 'grantee-mac', access: 'rw', enabled: true },
      { shareId: 1, granteeMac: 'grantee2-mac', access: 'ro', enabled: true },
    ]
    const { nodeAttrs } = buildTaildriveGrants(shares, access, macIp)
    const shareAttr = nodeAttrs.find((a) => a.attr.includes('drive:share'))
    expect(shareAttr!.target).toEqual(['100.64.0.1/32'])
    const accessAttr = nodeAttrs.find((a) => a.attr.includes('drive:access'))
    expect(accessAttr!.target.sort()).toEqual(['100.64.0.2/32', '100.64.0.3/32'])
  })

  it('không có share/access nào -> mảng rỗng', () => {
    const { nodeAttrs, grants } = buildTaildriveGrants([], [], macIp)
    expect(nodeAttrs).toEqual([])
    expect(grants).toEqual([])
  })
})
