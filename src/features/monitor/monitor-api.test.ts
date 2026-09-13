import { describe, expect, it } from 'vitest'
import {
  formatRate,
  formatUptime,
  levelOf,
  minutesAgo,
  systemUrl,
} from './monitor-api'

describe('systemUrl (link chi tiết máy trong Beszel)', () => {
  it('dùng id record, dạng /system/<id>', () => {
    expect(systemUrl('6z33opow942p26n')).toBe(
      'https://status.hangocthanh.io.vn/system/6z33opow942p26n'
    )
  })
  it('mã hóa ký tự đặc biệt, không để lọt sang path khác', () => {
    expect(systemUrl('a/b?c')).toBe(
      'https://status.hangocthanh.io.vn/system/a%2Fb%3Fc'
    )
  })
})

describe('levelOf (ngưỡng màu thanh %)', () => {
  it('dưới 70 xanh, 70–90 vàng, trên 90 đỏ', () => {
    expect(levelOf(0)).toBe('ok')
    expect(levelOf(69.9)).toBe('ok')
    expect(levelOf(70)).toBe('warn')
    expect(levelOf(90)).toBe('warn')
    expect(levelOf(90.1)).toBe('bad')
    expect(levelOf(100)).toBe('bad')
  })
})

describe('formatUptime', () => {
  it('dưới 48 giờ hiện giờ, từ 48 giờ hiện ngày', () => {
    expect(formatUptime(99 * 3600)).toBe('4 ngày')
    expect(formatUptime(47 * 3600 + 3599)).toBe('47 giờ')
    expect(formatUptime(114 * 86400)).toBe('114 ngày')
    expect(formatUptime(0)).toBe('0 giờ')
  })
  it('không có số liệu -> gạch ngang', () => {
    expect(formatUptime(null)).toBe('—')
  })
})

describe('formatRate', () => {
  it('chọn đơn vị B/s, KB/s, MB/s', () => {
    expect(formatRate(512)).toBe('512 B/s')
    expect(formatRate(11.52 * 1024)).toBe('11.5 KB/s')
    expect(formatRate(3 * 1024 * 1024)).toBe('3.0 MB/s')
  })
  it('không có số liệu -> gạch ngang', () => {
    expect(formatRate(null)).toBe('—')
  })
})

describe('minutesAgo', () => {
  const now = Date.parse('2026-09-13T18:07:00Z')
  it('đọc định dạng thời gian PocketBase (có dấu cách)', () => {
    expect(minutesAgo('2026-09-13 17:55:00.000Z', now)).toBe(12)
  })
  it('thời điểm tương lai (lệch đồng hồ) -> 0, không âm', () => {
    expect(minutesAgo('2026-09-13 18:10:00.000Z', now)).toBe(0)
  })
  it('rỗng hoặc sai định dạng -> null', () => {
    expect(minutesAgo(null, now)).toBeNull()
    expect(minutesAgo('không phải ngày', now)).toBeNull()
  })
})
