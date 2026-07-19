/**
 * Gộp lệnh ghi cho POST /api/telemetry/home-derp.
 *
 * Client (homederpreport.go) báo MỖI 3 GIÂY/máy và mỗi lần là một lệnh GHI DB
 * (~202ms đo trên prod). Đo 2026-07-19: đường này chiếm 31% traffic và là nguồn
 * tải DB lớn nhất còn lại sau khi cache browse-request. Ghi liên tục giữ Neon
 * compute endpoint thức 24/7 — chính là cơ chế đã đốt hết quota ngày 2026-07-18.
 *
 * Nhận xét: nội dung báo cáo hầu như KHÔNG đổi giữa các lần. Máy nằm yên một
 * DERP region hàng giờ. Nên chỉ ghi DB khi:
 *   1. lần đầu thấy máy này (sau khi container khởi động lại), HOẶC
 *   2. danh tính đổi (hostname / home region), HOẶC
 *   3. quá HOME_DERP_HEARTBEAT_MS kể từ lần ghi trước (nhịp tim).
 * Còn lại bỏ qua DB, vẫn trả {ok:true} — client không cần sửa, không cần build mới.
 *
 * ⚠️ controllerLatencyMs CỐ Ý không nằm trong phép so sánh: nó là số đo độ trễ,
 * gần như đổi mỗi lần lấy mẫu. Đưa nó vào thì không bao giờ gộp được lần nào.
 * Cái giá: độ trễ hiển thị trên dashboard chỉ mịn tới mức nhịp tim. Chấp nhận
 * được — đó là đồng hồ tham khảo, không phải cảnh báo.
 *
 * ⚠️ RÀNG BUỘC: cùng tiến trình, xem cảnh báo scale ngang ở lib/poll-cache.ts.
 */

/**
 * Nhịp tim: khoảng cách tối đa giữa hai lần ghi DB cho một máy đứng yên.
 *
 * ★ PHẢI NHỎ HƠN HẲN `windowMs` (60s) trong resolveDeviceLiveState()
 *   (lib/device-registry.ts) — hàm đó coi máy là "đang báo cáo" nếu reportedAt
 *   nằm trong 60 giây gần nhất. Nếu nhịp tim ≥ 60s thì reportedAt sẽ chạm mép
 *   cửa sổ và máy đang chạy bình thường bị nhấp nháy online/offline trên
 *   dashboard. 30s cho biên an toàn gấp đôi.
 *   Sửa số này thì phải kiểm lại windowMs ở đó — test đã khoá bất biến này.
 */
export const HOME_DERP_HEARTBEAT_MS = 30_000

/** Cửa sổ "đang báo cáo" phía đọc — nhân bản để test khoá được quan hệ hai số. */
export const DEVICE_REPORTING_WINDOW_MS = 60_000

/** Các trường quyết định "có gì đổi không". KHÔNG gồm số đo độ trễ. */
export type HomeDerpIdentity = {
  hostname: string
  homeRegionId?: number | null
  homeRegionCode?: string | null
}

type LastWrite = HomeDerpIdentity & { atMs: number }

/** So sánh danh tính, coi undefined và null là một (client cũ bỏ trống trường). */
export function homeDerpChanged(
  last: HomeDerpIdentity,
  next: HomeDerpIdentity
): boolean {
  return (
    last.hostname !== next.hostname ||
    (last.homeRegionId ?? null) !== (next.homeRegionId ?? null) ||
    (last.homeRegionCode ?? null) !== (next.homeRegionCode ?? null)
  )
}

export class HomeDerpWriteGate {
  private readonly last = new Map<string, LastWrite>()

  constructor(private readonly heartbeatMs: number = HOME_DERP_HEARTBEAT_MS) {}

  /**
   * Trả true nếu báo cáo này cần ghi DB. Trả true thì ĐÃ ghi nhận luôn, nên
   * gọi đúng một lần cho mỗi request và ghi DB ngay sau đó. Ghi DB hỏng thì
   * gọi forget(mac) để lần báo kế thử lại, đừng để im 30 giây.
   */
  admit(mac: string, next: HomeDerpIdentity, nowMs: number): boolean {
    const prev = this.last.get(mac)
    const due =
      !prev || nowMs - prev.atMs >= this.heartbeatMs || homeDerpChanged(prev, next)
    if (due) this.last.set(mac, { ...next, atMs: nowMs })
    return due
  }

  /** Quên máy này ⇒ báo cáo kế chắc chắn ghi DB. Dùng khi ghi DB thất bại. */
  forget(mac: string): void {
    this.last.delete(mac)
  }

  /** Số máy đang theo dõi — cho test/chẩn đoán. Bị chặn bởi số máy trong fleet. */
  get size(): number {
    return this.last.size
  }
}

export const homeDerpGate = new HomeDerpWriteGate()
