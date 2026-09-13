import type { HomeDerpRow } from './home-derp-api'

/** hostname (lowercase, trim) -> homeRegionCode của dòng home-derp MỚI NHẤT.
 *
 *  Một máy có thể có NHIỀU dòng home-derp (bảng khoá theo MAC; máy nhiều card
 *  mạng hoặc từng đổi card → nhiều MAC cùng hostname). Bản cũ duyệt mảng và
 *  `Map.set` đè liên tục — API trả reportedAt GIẢM dần nên dòng CŨ NHẤT thắng.
 *  Lỗi thật 2026-09-12: VOTAM-PC có dòng 5 ngày tuổi trỏ region 1003 (vpn6-vn),
 *  bảng "Thiết bị người dùng online" hiện vpn6-vn trong khi máy đang ở vpn4. */
export function newestHomeRegionByHost(
  rows: readonly HomeDerpRow[]
): Map<string, string> {
  const best = new Map<string, { code: string; at: number }>()
  for (const r of rows) {
    if (!r.homeRegionCode || !r.hostname) continue
    const host = r.hostname.toLowerCase().trim()
    const at = Date.parse(r.reportedAt)
    const t = Number.isNaN(at) ? -Infinity : at
    const cur = best.get(host)
    if (!cur || t > cur.at) best.set(host, { code: r.homeRegionCode, at: t })
  }
  return new Map([...best].map(([h, v]) => [h, v.code]))
}
