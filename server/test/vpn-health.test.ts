import { describe, it, expect } from 'vitest'
import {
  computeGatewayHealth,
  isGatewayAlerting,
  STALE_MS,
  type GwHealthInput,
} from '../src/lib/vpn-health'

const NOW = 1_700_000_000_000
const ago = (ms: number) => new Date(NOW - ms)

const base = (over: Partial<GwHealthInput>): GwHealthInput => ({
  enabled: true,
  desiredState: 'up',
  state: 'up',
  reportedAt: ago(10_000),
  ...over,
})

describe('computeGatewayHealth', () => {
  it("state 'up' còn mới -> healthy", () => {
    const h = computeGatewayHealth(base({}), NOW)
    expect(h.status).toBe('healthy')
    expect(h.ageSec).toBe(10)
  })

  it('agent im lặng quá STALE_MS -> stale (dù state cuối là up)', () => {
    const h = computeGatewayHealth(base({ reportedAt: ago(STALE_MS + 5_000) }), NOW)
    expect(h.status).toBe('stale')
    expect(isGatewayAlerting(h)).toBe(true)
  })

  it("state 'error' -> down", () => {
    const h = computeGatewayHealth(base({ state: 'error' }), NOW)
    expect(h.status).toBe('down')
    expect(isGatewayAlerting(h)).toBe(true)
  })

  it("state 'connecting' -> connecting", () => {
    expect(computeGatewayHealth(base({ state: 'connecting' }), NOW).status).toBe('connecting')
  })

  it('chưa có báo cáo -> unknown, ageSec null', () => {
    const h = computeGatewayHealth(base({ reportedAt: null }), NOW)
    expect(h.status).toBe('unknown')
    expect(h.ageSec).toBeNull()
  })

  it('desiredState=down -> stopped (không cảnh báo)', () => {
    const h = computeGatewayHealth(base({ desiredState: 'down', state: 'up' }), NOW)
    expect(h.status).toBe('stopped')
    expect(isGatewayAlerting(h)).toBe(false)
  })

  it('gateway disabled -> stopped', () => {
    expect(computeGatewayHealth(base({ enabled: false }), NOW).status).toBe('stopped')
  })

  it('healthy/connecting/unknown/stopped không cảnh báo', () => {
    for (const s of ['up', 'connecting'] as const) {
      expect(isGatewayAlerting(computeGatewayHealth(base({ state: s }), NOW))).toBe(false)
    }
  })
})
