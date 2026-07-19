/**
 * Cache RAM cho các đường client poll MỖI GIÂY.
 *
 * Bối cảnh (xem docs/rca-2026-07-18-dashboard-outage.md — nguyên nhân gốc A):
 * `GET /api/client/browse-request` và `GET /api/client/update-signal` được client
 * gọi mỗi 1 giây/máy chỉ để hỏi "có việc gì cho tôi không?", và câu trả lời gần
 * như luôn là "không". Đo thực tế: 117/195 request/phút (60%) là hai đường này.
 * Mỗi lần hỏi lại là một truy vấn DB ⇒ compute endpoint không bao giờ ngủ ⇒ đốt
 * sạch compute quota (sự cố 2026-07-18, dashboard chết 2,5 giờ).
 *
 * Cách chữa: giữ câu trả lời trong RAM. Poll đọc RAM (0 truy vấn DB); đường GHI
 * (admin bấm "Duyệt thư mục" / "Cập nhật ngay", client trả browse-result) gọi
 * invalidate() ⇒ lần poll kế nạp lại từ DB ⇒ **admin bấm nút vẫn hiệu lực trong
 * ~1 giây như cũ**. TTL chỉ là lưới an toàn cho ghi ngoài luồng (sửa DB tay).
 *
 * ⚠️ RÀNG BUỘC: cache nằm trong RAM của MỘT tiến trình. Hiện hệ thống chạy đúng
 * 1 container `derp-backend` nên an toàn. Nếu sau này chạy nhiều instance sau
 * load-balancer, invalidate ở instance A không tới instance B ⇒ phải chuyển sang
 * Redis/pub-sub hoặc bỏ cache. Đừng scale ngang mà quên chỗ này.
 */

/** Lưới an toàn: dữ liệu cũ tối đa 30s nếu có ai ghi thẳng vào DB, không qua API. */
export const POLL_CACHE_TTL_MS = 30_000

type Entry<T> = { value: T; at: number }

export class PollCache<T> {
  private readonly entries = new Map<string, Entry<T>>()

  constructor(private readonly ttlMs: number = POLL_CACHE_TTL_MS) {}

  /** Đọc từ RAM; quá hạn (hoặc chưa có) thì gọi `load()` rồi nhớ lại. */
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value
    const value = await load()
    this.entries.set(key, { value, at: Date.now() })
    return value
  }

  /**
   * Gọi NGAY SAU khi ghi DB cho `key` này. Bỏ bản nhớ ⇒ lần poll kế đọc lại DB
   * ⇒ client thấy thay đổi trong một chu kỳ poll (~1s), không phải chờ hết TTL.
   */
  invalidate(key: string): void {
    this.entries.delete(key)
  }

  /** Thay đổi ảnh hưởng MỌI máy (vd "Cập nhật ngay" cho cả fleet). */
  invalidateAll(): void {
    this.entries.clear()
  }

  /** Số khoá đang nhớ — dùng cho test/chẩn đoán. Bị chặn bởi số máy trong fleet. */
  get size(): number {
    return this.entries.size
  }
}

/** Yêu cầu duyệt thư mục đang chờ, theo mac. Giá trị = đường dẫn, hoặc null. */
export const browseRequestCache = new PollCache<string | null>()

/** Mốc update_check_at theo mac (chuỗi ISO, hoặc null). */
export const updateSignalCache = new PollCache<string | null>()
