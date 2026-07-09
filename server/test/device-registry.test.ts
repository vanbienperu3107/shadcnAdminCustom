import { describe, it, expect } from 'vitest'
import {
  resolveClientDeviceAction,
  normalizeNodeKey,
  normalizeHostForMatch,
  staleNodesHoldingIp,
  isDeviceOnline,
  isCiRunnerHostname,
  resolveDeviceLiveState,
  versionChangeDirection,
} from '../src/lib/device-registry'

describe('isCiRunnerHostname', () => {
  it('runnervm… (GitHub Windows runner) → true', () => {
    expect(isCiRunnerHostname('runnervmuktm0')).toBe(true)
    expect(isCiRunnerHostname('RUNNERVMABC123')).toBe(true)
  })
  it('fv-az… (Azure runner) → true', () => {
    expect(isCiRunnerHostname('fv-az123-456')).toBe(true)
  })
  it('máy thật → false', () => {
    expect(isCiRunnerHostname('ITOP-THANHHN5')).toBe(false)
    expect(isCiRunnerHostname('VOTAM-PC')).toBe(false)
    expect(isCiRunnerHostname('runner-pc-cua-thanh')).toBe(false) // không phải "runnervm"
  })
  it('rỗng/null → false', () => {
    expect(isCiRunnerHostname('')).toBe(false)
    expect(isCiRunnerHostname(null)).toBe(false)
    expect(isCiRunnerHostname(undefined)).toBe(false)
  })
})

describe('versionChangeDirection', () => {
  it('prev null → initial (lần đầu có build)', () => {
    expect(versionChangeDirection(null, 70)).toBe('initial')
  })
  it('build tăng → upgrade', () => {
    expect(versionChangeDirection(70, 72)).toBe('upgrade')
  })
  it('build giảm → downgrade (rollback)', () => {
    expect(versionChangeDirection(72, 70)).toBe('downgrade')
  })
})

const row = (id: number) => ({ id })

describe('resolveClientDeviceAction', () => {
  it('INSERT khi chưa có dòng nào theo mac lẫn node_key', () => {
    expect(resolveClientDeviceAction(undefined, undefined)).toEqual({
      kind: 'insert',
    })
  })

  it('UPDATE khi dòng theo mac và node_key là CÙNG dòng (re-register bình thường)', () => {
    expect(resolveClientDeviceAction(row(7), row(7))).toEqual({
      kind: 'update-by-mac',
      id: 7,
    })
  })

  it('UPDATE khi có dòng theo mac, node_key chưa dùng (node đổi node_key sau cài lại)', () => {
    expect(resolveClientDeviceAction(row(7), undefined)).toEqual({
      kind: 'update-by-mac',
      id: 7,
    })
  })

  // Regression cho lỗi 502 "duplicate key ... device_identity_node_key_unique":
  // node_key đã tồn tại ở 1 dòng (vd dòng backfill mac=null) nhưng mac hiện tại
  // chưa có dòng nào → PHẢI neo mac vào dòng node_key, KHÔNG được INSERT mới.
  it('ADOPT khi node_key đã có dòng nhưng mac chưa có dòng (backfill mac=null)', () => {
    expect(resolveClientDeviceAction(undefined, row(3))).toEqual({
      kind: 'adopt-node-key',
      keyRowId: 3,
      clearMacFromId: null,
    })
  })

  it('ADOPT + gỡ mac khỏi dòng cũ khi mac và node_key nằm ở 2 dòng khác nhau', () => {
    expect(resolveClientDeviceAction(row(5), row(3))).toEqual({
      kind: 'adopt-node-key',
      keyRowId: 3,
      clearMacFromId: 5,
    })
  })
})

describe('normalizeNodeKey', () => {
  it('thêm tiền tố nodekey: và hạ chữ thường', () => {
    expect(normalizeNodeKey('ABCDEF')).toBe('nodekey:abcdef')
  })
  it('giữ nguyên khi đã có tiền tố', () => {
    expect(normalizeNodeKey('nodekey:abc')).toBe('nodekey:abc')
  })
  it('trả null cho rỗng/null/khoảng trắng', () => {
    expect(normalizeNodeKey('')).toBeNull()
    expect(normalizeNodeKey(null)).toBeNull()
    expect(normalizeNodeKey('   ')).toBeNull()
  })
})

describe('normalizeHostForMatch', () => {
  it('hạ chữ thường + bỏ hậu tố dedup -N', () => {
    expect(normalizeHostForMatch('ITOP-THANHHN5')).toBe('itop-thanhhn5')
    expect(normalizeHostForMatch('itop-thanhhn5-1')).toBe('itop-thanhhn5')
    expect(normalizeHostForMatch('VOTAM-PC-12')).toBe('votam-pc')
    expect(normalizeHostForMatch(null)).toBe('')
    expect(normalizeHostForMatch('  Máy-2 ')).toBe('máy')
  })
})

describe('staleNodesHoldingIp', () => {
  const nodes = [
    // dup cũ CÙNG máy, OFFLINE, đang giữ IP đích -> phải thu hồi
    { id: '50', givenName: 'ITOP-THANHHN5', ipAddresses: ['100.64.0.14', 'fd7a::e'], online: false },
    { id: '49', givenName: 'votam-pc', ipAddresses: ['100.64.0.12'], online: true }, // máy khác
    { id: '18', givenName: 'vpn4', ipAddresses: ['100.64.0.4'], online: true },
  ]

  it('thu hồi node CÙNG máy, OFFLINE, đang giữ IP đích', () => {
    expect(staleNodesHoldingIp('100.64.0.14', 'itop-thanhhn5', nodes)).toEqual(['50'])
  })
  it('khớp kể cả khác hoa/thường và có hậu tố dedup', () => {
    const n = [{ id: '7', name: 'ITOP-THANHHN5-1', ipAddresses: ['100.64.0.14'], online: false }]
    expect(staleNodesHoldingIp('100.64.0.14', 'itop-thanhhn5', n)).toEqual(['7'])
  })
  it('KHÔNG xóa node đang ONLINE dù trùng tên + giữ IP (an toàn)', () => {
    const n = [{ id: '9', givenName: 'ITOP-THANHHN5', ipAddresses: ['100.64.0.14'], online: true }]
    expect(staleNodesHoldingIp('100.64.0.14', 'itop-thanhhn5', n)).toEqual([])
  })
  it('KHÔNG xóa node online=undefined (không rõ trạng thái)', () => {
    const n = [{ id: '9', givenName: 'ITOP-THANHHN5', ipAddresses: ['100.64.0.14'] }]
    expect(staleNodesHoldingIp('100.64.0.14', 'itop-thanhhn5', n)).toEqual([])
  })
  it('KHÔNG đụng máy KHÁC dù nó đang giữ IP đích (tránh xóa nhầm)', () => {
    const n = [{ id: '49', givenName: 'votam-pc', ipAddresses: ['100.64.0.12'], online: false }]
    expect(staleNodesHoldingIp('100.64.0.12', 'itop-thanhhn5', n)).toEqual([])
  })
  it('không có node nào giữ IP -> rỗng', () => {
    expect(staleNodesHoldingIp('100.64.0.99', 'itop-thanhhn5', nodes)).toEqual([])
  })
  it('thiếu ip/hostname -> rỗng (an toàn)', () => {
    expect(staleNodesHoldingIp('', 'itop', nodes)).toEqual([])
    expect(staleNodesHoldingIp('100.64.0.14', '', nodes)).toEqual([])
  })
  it('bỏ qua node không có id', () => {
    const n = [{ givenName: 'itop-thanhhn5', ipAddresses: ['100.64.0.14'], online: false }]
    expect(staleNodesHoldingIp('100.64.0.14', 'itop-thanhhn5', n)).toEqual([])
  })
})

describe('isDeviceOnline', () => {
  const now = 1_000_000_000_000
  it('online nếu thấy trong 60s', () => {
    expect(isDeviceOnline(now - 5_000, now)).toBe(true)
    expect(isDeviceOnline(now - 59_000, now)).toBe(true)
  })
  it('offline nếu quá 60s', () => {
    expect(isDeviceOnline(now - 61_000, now)).toBe(false)
    expect(isDeviceOnline(now - 3_600_000, now)).toBe(false)
  })
  it('chưa từng báo (null) -> offline', () => {
    expect(isDeviceOnline(null, now)).toBe(false)
  })
  it('cửa sổ tuỳ chỉnh', () => {
    expect(isDeviceOnline(now - 90_000, now, 120_000)).toBe(true)
    expect(isDeviceOnline(now - 90_000, now, 30_000)).toBe(false)
  })
})

describe('resolveDeviceLiveState', () => {
  const now = 1_000_000_000_000
  const fresh = now - 5_000
  const stale = now - 32 * 3_600_000 // 32h — đúng độ trễ của votam lúc gặp bug

  it('telemetry tươi -> online + reporting', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: fresh,
        headscaleOnline: true,
        nowMs: now,
      })
    ).toEqual({ online: true, reporting: true })
  })

  // Chính là ca VOTAM-PC: máy chạy, headscale giữ map-poll 32h, nhưng reporter
  // chốt MAC rỗng nên telemetry bị 400 -> phải là ONLINE nhưng KHÔNG báo cáo,
  // TUYỆT ĐỐI không được hiện Offline.
  it('headscale online + telemetry chết -> online nhưng reporting=false', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: stale,
        headscaleOnline: true,
        nowMs: now,
      })
    ).toEqual({ online: true, reporting: false })
  })

  it('chưa từng báo telemetry nhưng headscale online -> vẫn online', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: null,
        headscaleOnline: true,
        nowMs: now,
      })
    ).toEqual({ online: true, reporting: false })
  })

  it('headscale offline + telemetry chết -> offline', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: stale,
        headscaleOnline: false,
        nowMs: now,
      })
    ).toEqual({ online: false, reporting: false })
  })

  // Telemetry tươi thắng cả khi headscale nói offline: client rõ ràng đang nói
  // chuyện được với dashboard.
  it('headscale offline + telemetry tươi -> online', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: fresh,
        headscaleOnline: false,
        nowMs: now,
      })
    ).toEqual({ online: true, reporting: true })
  })

  // headscaleOnline=null = không biết (chưa cấu hình key / gọi lỗi) -> giữ
  // nguyên hành vi cũ: chỉ dựa telemetry, không hồi quy.
  it('headscale không rõ (null) -> chỉ dựa telemetry', () => {
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: fresh,
        headscaleOnline: null,
        nowMs: now,
      })
    ).toEqual({ online: true, reporting: true })
    expect(
      resolveDeviceLiveState({
        telemetrySeenMs: stale,
        headscaleOnline: null,
        nowMs: now,
      })
    ).toEqual({ online: false, reporting: false })
  })
})
