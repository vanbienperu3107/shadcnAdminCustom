import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/lib/password'

describe('password scrypt', () => {
  it('hash rồi verify đúng mật khẩu', async () => {
    const hash = await hashPassword('S3cret-pass!')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('S3cret-pass!', hash)).toBe(true)
  })

  it('từ chối mật khẩu sai', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  it('mỗi lần hash có salt khác nhau', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same', a)).toBe(true)
    expect(await verifyPassword('same', b)).toBe(true)
  })

  it('trả false với hash null/rỗng/định dạng lỗi', async () => {
    expect(await verifyPassword('x', null)).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$16384$8$1$zz$zz')).toBe(false)
  })
})
