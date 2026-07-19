import { describe, it, expect } from 'vitest'
import {
  HomeDerpWriteGate,
  HOME_DERP_HEARTBEAT_MS,
  DEVICE_REPORTING_WINDOW_MS,
} from '../src/lib/home-derp-coalesce'
import { resolveDeviceLiveState } from '../src/lib/device-registry'

const MAC = 'f8:cf:11:22:33:44'
const BASE = { hostname: 'VOTAM-PC', homeRegionId: 1003, homeRegionCode: 'vpn6' }

describe('HomeDerpWriteGate', () => {
  it('lần đầu thấy máy thì ghi', () => {
    const gate = new HomeDerpWriteGate()
    expect(gate.admit(MAC, BASE, 0)).toBe(true)
  })

  it('báo lại y hệt trong nhịp tim thì BỎ QUA (đây là chỗ tiết kiệm)', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(gate.admit(MAC, BASE, 3_000)).toBe(false)
    expect(gate.admit(MAC, BASE, 6_000)).toBe(false)
    expect(gate.admit(MAC, BASE, 29_000)).toBe(false)
  })

  it('đổi DERP region thì ghi NGAY, không đợi nhịp tim', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(
      gate.admit(MAC, { ...BASE, homeRegionId: 2000, homeRegionCode: 'vpn2-vn' }, 3_000)
    ).toBe(true)
  })

  it('đổi hostname thì ghi ngay', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(gate.admit(MAC, { ...BASE, hostname: 'ITOP-PC' }, 3_000)).toBe(true)
  })

  it('region về null (mất DERP nhà) cũng là thay đổi, phải ghi', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(
      gate.admit(MAC, { hostname: 'VOTAM-PC', homeRegionId: null, homeRegionCode: null }, 3_000)
    ).toBe(true)
  })

  it('undefined và null coi như một — client cũ bỏ trống trường, đừng ghi oan', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, { hostname: 'A', homeRegionId: null, homeRegionCode: null }, 0)
    expect(gate.admit(MAC, { hostname: 'A' }, 3_000)).toBe(false)
  })

  it('hết nhịp tim thì ghi lại dù không có gì đổi', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(gate.admit(MAC, BASE, HOME_DERP_HEARTBEAT_MS - 1)).toBe(false)
    expect(gate.admit(MAC, BASE, HOME_DERP_HEARTBEAT_MS)).toBe(true)
  })

  it('mỗi mac độc lập', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit('aa', BASE, 0)
    expect(gate.admit('bb', BASE, 1_000)).toBe(true) // máy khác, lần đầu
    expect(gate.admit('aa', BASE, 1_000)).toBe(false)
  })

  it('forget ⇒ báo kế ghi lại ngay (dùng khi ghi DB hỏng)', () => {
    const gate = new HomeDerpWriteGate()
    gate.admit(MAC, BASE, 0)
    expect(gate.admit(MAC, BASE, 3_000)).toBe(false)
    gate.forget(MAC)
    expect(gate.admit(MAC, BASE, 6_000)).toBe(true)
  })

  it('máy đứng yên: 3s/lần trong 5 phút ⇒ 11 lệnh ghi thay vì 100', () => {
    const gate = new HomeDerpWriteGate()
    let writes = 0
    for (let t = 0; t < 300_000; t += 3_000) if (gate.admit(MAC, BASE, t)) writes++
    expect(writes).toBe(11) // t=0 rồi mỗi 30s
  })
})

describe('nhịp tim vs cửa sổ "đang báo cáo"', () => {
  it('★ BẤT BIẾN: nhịp tim phải nhỏ hơn hẳn cửa sổ 60s', () => {
    expect(HOME_DERP_HEARTBEAT_MS).toBeLessThan(DEVICE_REPORTING_WINDOW_MS / 2 + 1)
  })

  it('★ máy đứng yên KHÔNG được nhấp nháy offline — kiểm với hàm thật', () => {
    // Xấu nhất: dashboard hỏi ngay trước lần ghi nhịp tim kế tiếp, nên
    // reportedAt cũ đúng bằng một nhịp tim.
    const nowMs = 1_000_000
    const telemetrySeenMs = nowMs - HOME_DERP_HEARTBEAT_MS
    const { online, reporting } = resolveDeviceLiveState({
      telemetrySeenMs,
      headscaleOnline: null,
      nowMs,
    })
    expect(reporting).toBe(true)
    expect(online).toBe(true)
  })

  it('★ kể cả trễ thêm một chu kỳ báo cáo vẫn an toàn', () => {
    const nowMs = 1_000_000
    const { reporting } = resolveDeviceLiveState({
      telemetrySeenMs: nowMs - (HOME_DERP_HEARTBEAT_MS + 3_000),
      headscaleOnline: null,
      nowMs,
    })
    expect(reporting).toBe(true)
  })
})
