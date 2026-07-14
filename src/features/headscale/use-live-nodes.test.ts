import { describe, expect, it } from 'vitest'
import { pickNodeOnline, pickNodeReporting } from './use-live-nodes'

// Ma trận PHẢI khớp resolveDeviceLiveState phía server
// (server/src/lib/device-registry.ts + server/test/device-registry.test.ts) để
// hai tầng không lệch nhau — chính chỗ lệch đã gây bug tab Latency báo offline.
describe('pickNodeOnline', () => {
  it('CA VOTAM-PC: có dòng live online=true, headscale thô=false → online', () => {
    // Telemetry tươi (live.online=true từ /api/devices/live) nhưng cờ map-poll
    // headscale flap về false. Bản hợp nhất phải thắng = online.
    expect(pickNodeOnline({ online: true }, false)).toBe(true)
  })

  it('có dòng live online=false, headscale thô=true → false (live thắng)', () => {
    // Đã có dòng live thì live.online là kết quả hợp nhất cuối cùng, không để cờ
    // thô ghi đè.
    expect(pickNodeOnline({ online: false }, true)).toBe(false)
  })

  it('chưa có dòng live, headscale thô=true → true (fallback: infra/chưa backfill)', () => {
    expect(pickNodeOnline(undefined, true)).toBe(true)
  })

  it('chưa có dòng live, headscale thô=false → false', () => {
    expect(pickNodeOnline(undefined, false)).toBe(false)
  })

  it('chưa có dòng live, headscale thô=undefined → false (an toàn)', () => {
    expect(pickNodeOnline(undefined, undefined)).toBe(false)
  })
})

describe('pickNodeReporting', () => {
  it('có dòng live reporting=false → false (reporter hỏng dù online)', () => {
    expect(pickNodeReporting({ reporting: false })).toBe(false)
  })

  it('có dòng live reporting=true → true', () => {
    expect(pickNodeReporting({ reporting: true })).toBe(true)
  })

  it('chưa có dòng live → true (không gắn cờ "reporter hỏng" nhầm)', () => {
    expect(pickNodeReporting(undefined)).toBe(true)
  })
})
