import { describe, it, expect } from 'vitest'
import { matchHsUserId, type HsUserLite } from '../src/lib/hs-users'

// Mirrors the real headscale tailnet: user 1 is a plain login name, user 2 is
// an OIDC user whose `name` is an email (this is the case headscale's `?name=`
// server-side filter returned EMPTY for, breaking pre-auth key create/list/expire).
const users: HsUserLite[] = [
  { id: '1', name: 'votam', displayName: '', email: '' },
  {
    id: '2',
    name: 'hangocthanh3107@gmail.com',
    displayName: 'thành hà ngọc',
    email: 'hangocthanh3107@gmail.com',
  },
]

describe('matchHsUserId', () => {
  it('numeric id passes through (even with no user list)', () => {
    expect(matchHsUserId(users, '2')).toBe('2')
    expect(matchHsUserId([], '7')).toBe('7')
  })
  it('matches by login name', () => {
    expect(matchHsUserId(users, 'votam')).toBe('1')
  })
  it('regression: OIDC user resolvable by email/name (was ?name= empty)', () => {
    expect(matchHsUserId(users, 'hangocthanh3107@gmail.com')).toBe('2')
  })
  it('matches by displayName', () => {
    expect(matchHsUserId(users, 'thành hà ngọc')).toBe('2')
  })
  it('case-insensitive fallback', () => {
    expect(matchHsUserId(users, 'VOTAM')).toBe('1')
    expect(matchHsUserId(users, 'HANGOCTHANH3107@GMAIL.COM')).toBe('2')
  })
  it('no match -> null', () => {
    expect(matchHsUserId(users, 'nobody')).toBeNull()
  })
  it('empty ident -> null (must not match a user with empty email/displayName)', () => {
    expect(matchHsUserId(users, '')).toBeNull()
  })
})
