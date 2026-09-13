import { describe, it, expect } from 'vitest'
import { rekeyDerpTables } from '../src/lib/device-registry'
import {
  derpNodeAssignments,
  derpNodeHealth,
  derpNodeOptions,
} from '../src/db/schema'

/** Transaction giả: ghi lại thứ tự lệnh, và cho select trả số dòng tuỳ bảng.
 *  Đủ để khoá hợp đồng "xoá dòng của key MỚI trước rồi mới UPDATE" — chính là
 *  chỗ gây 502 duplicate key derp_node_health_pkey (VOTAM-PC, 2026-09-12). */
function fakeTx(oldRowsByTable: Map<unknown, number>) {
  const ops: string[] = []
  const name = (t: unknown) =>
    t === derpNodeAssignments ? 'assign' : t === derpNodeOptions ? 'options' : t === derpNodeHealth ? 'health' : '?'
  return {
    ops,
    tx: {
      select: () => ({
        from: (t: unknown) => ({
          where: async () => Array.from({ length: oldRowsByTable.get(t) ?? 0 }, () => ({})),
        }),
      }),
      delete: (t: unknown) => ({
        where: async () => {
          ops.push(`delete-new:${name(t)}`)
        },
      }),
      update: (t: unknown) => ({
        set: () => ({
          where: async () => {
            ops.push(`update-old:${name(t)}`)
          },
        }),
      }),
    },
  }
}

describe('rekeyDerpTables', () => {
  it('oldKey co dong o ca 3 bang -> moi bang XOA dong newKey TRUOC roi moi UPDATE', async () => {
    const { tx, ops } = fakeTx(
      new Map<unknown, number>([
        [derpNodeAssignments, 1],
        [derpNodeOptions, 1],
        [derpNodeHealth, 1],
      ])
    )
    await rekeyDerpTables(tx, 'nodekey:old', 'nodekey:new')
    expect(ops).toEqual([
      'delete-new:assign',
      'update-old:assign',
      'delete-new:options',
      'update-old:options',
      'delete-new:health',
      'update-old:health',
    ])
  })

  // Ca that gay 502: health cua key moi da duoc sweep tao san. Chi can oldKey co
  // dong health la phai xoa dong moi truoc — neu UPDATE truoc se dung PK.
  it('chi bang health co dong oldKey -> chi dong vao health, dung thu tu', async () => {
    const { tx, ops } = fakeTx(new Map<unknown, number>([[derpNodeHealth, 1]]))
    await rekeyDerpTables(tx, 'nodekey:old', 'nodekey:new')
    expect(ops).toEqual(['delete-new:health', 'update-old:health'])
  })

  it('oldKey khong co dong nao -> KHONG xoa cau hinh dang co cua newKey', async () => {
    const { tx, ops } = fakeTx(new Map())
    await rekeyDerpTables(tx, 'nodekey:old', 'nodekey:new')
    expect(ops).toEqual([])
  })
})
