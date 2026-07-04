import { describe, it, expect } from 'vitest'
import {
  resolveClientDeviceAction,
  normalizeNodeKey,
} from '../src/lib/device-registry'

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
