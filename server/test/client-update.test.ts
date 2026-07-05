import { describe, it, expect } from 'vitest'
import { pickRelease } from '../src/routes/client-update'

const rel = (build: number) => ({
  build,
  version: `v${build}`,
  assets: [],
})

// releases luôn sắp build giảm dần (loadReleases đảm bảo)
const releases = [rel(42), rel(41), rel(40)]

describe('pickRelease', () => {
  it('disabled → null (kill-switch)', () => {
    expect(pickRelease(releases, { enabled: false, pinnedBuild: null })).toBeNull()
  })

  it('enabled, không pin → build mới nhất', () => {
    expect(pickRelease(releases, { enabled: true, pinnedBuild: null })).toMatchObject({
      build: 42,
    })
  })

  it('enabled, pin build cũ → đúng build đó (hỗ trợ rollback)', () => {
    expect(pickRelease(releases, { enabled: true, pinnedBuild: 40 })).toMatchObject({
      build: 40,
      version: 'v40',
    })
  })

  it('pin build không tồn tại → null (an toàn)', () => {
    expect(pickRelease(releases, { enabled: true, pinnedBuild: 999 })).toBeNull()
  })

  it('enabled nhưng chưa có release nào → null', () => {
    expect(pickRelease([], { enabled: true, pinnedBuild: null })).toBeNull()
  })
})
