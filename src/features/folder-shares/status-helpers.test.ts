import { describe, expect, it } from 'vitest'
import type { FolderShareStatus } from './data/folder-shares-api'
import { granteeMountStatus, ownerServeStatus } from './status-helpers'

const st = (over: Partial<FolderShareStatus>): FolderShareStatus => ({
  mac: 'x',
  hostname: null,
  reportedAt: null,
  shares: [],
  mounts: [],
  ...over,
})

describe('ownerServeStatus', () => {
  it('không có report → null (chờ)', () => {
    expect(ownerServeStatus(undefined, 'tool')).toBeNull()
  })
  it('share serve OK', () => {
    const r = ownerServeStatus(
      st({ shares: [{ name: 'tool', ok: true }] }),
      'tool'
    )
    expect(r).toEqual({ ok: true, error: null })
  })
  it('share serve lỗi giữ error', () => {
    const r = ownerServeStatus(
      st({ shares: [{ name: 'tool', ok: false, error: 'path not found' }] }),
      'tool'
    )
    expect(r).toEqual({ ok: false, error: 'path not found' })
  })
  it('share khác tên → null', () => {
    expect(
      ownerServeStatus(st({ shares: [{ name: 'other', ok: true }] }), 'tool')
    ).toBeNull()
  })
})

describe('granteeMountStatus', () => {
  it('mount lỗi 67 giữ nguyên error', () => {
    const r = granteeMountStatus(
      st({
        mounts: [{ share: 'tool', ok: false, error: 'System error 67' }],
      }),
      'tool'
    )
    expect(r).toEqual({ ok: false, error: 'System error 67' })
  })
  it('mount OK', () => {
    expect(
      granteeMountStatus(
        st({ mounts: [{ share: 'tool', drive: 'Z:', ok: true }] }),
        'tool'
      )
    ).toEqual({ ok: true, error: null })
  })
  it('chưa báo → null', () => {
    expect(granteeMountStatus(undefined, 'tool')).toBeNull()
  })
})
