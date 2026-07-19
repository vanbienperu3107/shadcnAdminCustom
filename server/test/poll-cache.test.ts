import { describe, it, expect, vi, afterEach } from 'vitest'
import { PollCache } from '../src/lib/poll-cache'

afterEach(() => {
  vi.useRealTimers()
})

describe('PollCache', () => {
  it('lần đầu gọi load, các lần sau đọc RAM (đây là chỗ tiết kiệm DB)', async () => {
    const cache = new PollCache<number>(30_000)
    const load = vi.fn(async () => 42)

    expect(await cache.get('aa:bb', load)).toBe(42)
    expect(await cache.get('aa:bb', load)).toBe(42)
    expect(await cache.get('aa:bb', load)).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('mỗi mac là một khoá riêng, không lẫn đáp án của nhau', async () => {
    const cache = new PollCache<string>(30_000)
    await cache.get('aa', async () => 'A')
    await cache.get('bb', async () => 'B')

    expect(await cache.get('aa', async () => 'KHONG_DUOC_GOI')).toBe('A')
    expect(await cache.get('bb', async () => 'KHONG_DUOC_GOI')).toBe('B')
  })

  it('nhớ cả giá trị null — "không có việc gì" là câu trả lời phổ biến nhất', async () => {
    const cache = new PollCache<string | null>(30_000)
    const load = vi.fn(async () => null)

    await cache.get('aa', load)
    await cache.get('aa', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('invalidate ⇒ lần poll kế nạp lại (admin bấm nút hiệu lực trong ~1s)', async () => {
    const cache = new PollCache<string>(30_000)
    let dbValue = 'chua-co-yeu-cau'
    const load = async () => dbValue

    expect(await cache.get('aa', load)).toBe('chua-co-yeu-cau')

    // Admin ghi DB rồi invalidate — đúng thứ tự trong route.
    dbValue = 'D:\\ChiaSe'
    cache.invalidate('aa')

    expect(await cache.get('aa', load)).toBe('D:\\ChiaSe')
  })

  it('KHÔNG invalidate ⇒ vẫn trả bản cũ (chứng minh invalidate là bắt buộc)', async () => {
    const cache = new PollCache<string>(30_000)
    let dbValue = 'cu'
    const load = async () => dbValue

    await cache.get('aa', load)
    dbValue = 'moi'
    expect(await cache.get('aa', load)).toBe('cu')
  })

  it('invalidateAll xoá mọi máy (nút "Cập nhật ngay" toàn fleet)', async () => {
    const cache = new PollCache<string>(30_000)
    await cache.get('aa', async () => 'A')
    await cache.get('bb', async () => 'B')
    expect(cache.size).toBe(2)

    cache.invalidateAll()
    expect(cache.size).toBe(0)
  })

  it('invalidate khoá chưa có thì im lặng bỏ qua', () => {
    const cache = new PollCache<string>(30_000)
    expect(() => cache.invalidate('khong-ton-tai')).not.toThrow()
  })

  it('hết TTL thì tự nạp lại — lưới an toàn cho ghi thẳng vào DB', async () => {
    vi.useFakeTimers()
    const cache = new PollCache<string>(30_000)
    let dbValue = 'cu'
    const load = vi.fn(async () => dbValue)

    expect(await cache.get('aa', load)).toBe('cu')

    // Ai đó sửa DB tay, không qua API ⇒ không có invalidate.
    dbValue = 'moi'
    vi.advanceTimersByTime(29_000)
    expect(await cache.get('aa', load)).toBe('cu') // còn hạn

    vi.advanceTimersByTime(2_000)
    expect(await cache.get('aa', load)).toBe('moi') // 31s > TTL ⇒ nạp lại
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('load ném lỗi thì lỗi nổi lên, KHÔNG nhớ lỗi lại', async () => {
    const cache = new PollCache<string>(30_000)
    await expect(
      cache.get('aa', async () => {
        throw new Error('db down')
      })
    ).rejects.toThrow('db down')
    expect(cache.size).toBe(0)

    // DB sống lại là dùng được ngay, không phải chờ hết TTL.
    expect(await cache.get('aa', async () => 'ok')).toBe('ok')
  })
})
