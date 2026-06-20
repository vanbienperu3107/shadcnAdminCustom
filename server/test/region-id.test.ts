import { describe, it, expect } from 'vitest'
import {
  nextRegionId,
  isValidUserRegionId,
  EMBEDDED_REGION_ID,
  USER_REGION_MIN,
} from '../src/lib/region-id'

describe('nextRegionId', () => {
  it('rỗng -> 1000', () => {
    expect(nextRegionId([])).toBe(USER_REGION_MIN)
  })

  it('1000..1003 -> 1004 (tự tăng)', () => {
    expect(nextRegionId([1000, 1001, 1002, 1003])).toBe(1004)
  })

  it('có embedded 999 -> vẫn 1000, không bao giờ cấp 999', () => {
    expect(nextRegionId([999])).toBe(1000)
    expect(nextRegionId([999, 1000, 1001])).toBe(1002)
  })

  it('lấp khe trống khi đụng trần', () => {
    const used: number[] = []
    for (let i = 1000; i <= 1099; i++) if (i !== 1005) used.push(i)
    expect(nextRegionId(used)).toBe(1005)
  })

  it('ném lỗi khi hết dải', () => {
    const full: number[] = []
    for (let i = 1000; i <= 1099; i++) full.push(i)
    expect(() => nextRegionId(full)).toThrow()
  })
})

describe('isValidUserRegionId', () => {
  it('chấp nhận trong dải, từ chối 999 và ngoài dải', () => {
    expect(isValidUserRegionId(1000)).toBe(true)
    expect(isValidUserRegionId(1099)).toBe(true)
    expect(isValidUserRegionId(EMBEDDED_REGION_ID)).toBe(false)
    expect(isValidUserRegionId(999)).toBe(false)
    expect(isValidUserRegionId(1100)).toBe(false)
    expect(isValidUserRegionId(1000.5)).toBe(false)
  })
})
