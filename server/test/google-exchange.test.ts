import dns from 'node:dns'
import net from 'node:net'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Sự cố 2026-09-14: fetch tới oauth2.googleapis.com ném "fetch failed" (ETIMEDOUT
// happy-eyeballs 250ms) → login Google hỏng. Test mặc định mạng + retry exchangeCode.

type Google = typeof import('../src/auth/google.js')
let google: Google

const TOKENS = { access_token: 'a', id_token: 'x.y.z', expires_in: 3600 }
const okResponse = () =>
  new Response(JSON.stringify(TOKENS), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/db'
  google = await import('../src/auth/google.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('net-defaults', () => {
  it('ưu tiên IPv4 và nới attempt timeout lên 2000ms', async () => {
    const { AUTO_SELECT_ATTEMPT_TIMEOUT_MS } = await import(
      '../src/lib/net-defaults.js'
    )
    expect(AUTO_SELECT_ATTEMPT_TIMEOUT_MS).toBe(2000)
    expect(dns.getDefaultResultOrder()).toBe('ipv4first')
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(2000)
  })
})

describe('exchangeCode', () => {
  it('thành công ngay lần đầu → gọi fetch 1 lần, trả token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    await expect(google.exchangeCode('c1')).resolves.toEqual(TOKENS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(String(init.body)).toContain('code=c1')
    expect(String(init.body)).toContain('grant_type=authorization_code')
  })

  it('lỗi mạng lần 1 (fetch failed) → thử lại và thành công', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse())
    vi.stubGlobal('fetch', fetchMock)
    await expect(google.exchangeCode('c2')).resolves.toEqual(TOKENS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][1].body)).toContain('code=c2')
  })

  it('lỗi mạng cả 2 lần → ném lỗi, không thử quá 2 lần', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(google.exchangeCode('c3')).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Google trả HTTP lỗi → ném ngay, không thử lại', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(google.exchangeCode('c4')).rejects.toThrow(
      /Google token exchange failed \(400\).*invalid_grant/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lỗi không phải TypeError → ném ngay, không thử lại', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(google.exchangeCode('c5')).rejects.toThrow('boom')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
