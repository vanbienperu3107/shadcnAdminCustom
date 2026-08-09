/**
 * Suy danh sách subnet route mà VPN gateway nên quảng bá, TỪ CHÍNH bảng
 * `vpn_domains` (mục "TRANG ĐI QUA VPN" trên dashboard).
 *
 * Ý tưởng: admin chỉ cần một chỗ để khai báo "cái này đi qua VPN". Mục nào là
 * TÊN MIỀN thì chỉ vào PAC (proxy, chỉ cứu được HTTP/HTTPS); mục nào là ĐỊA CHỈ
 * IP / CIDR thì ngoài PAC còn thành subnet route để RDP/SMB/mọi giao thức cũng
 * đi được. Không cần bảng mới, không cần sửa workflow deploy.
 *
 * ⚠️ MIN_PREFIX là bài học từ sự cố 2026-08-09: gateway từng quảng bá
 * `10.121.0.0/16` trong khi đường OpenVPN chỉ với tới ~42 prefix rời rạc. Khi nó
 * giành quyền phục vụ, mọi IP ngoài vùng đó (10.121.20.x web nội bộ,
 * 10.121.13.x remote DC) bị chặn thẳng và người dùng mất truy cập nhiều giờ.
 * Quảng bá rộng hơn vùng thật = hứa điều không giữ được, nên chặn ngay từ đây.
 */

/** Prefix hẹp nhất được phép quảng bá. /24 = 256 địa chỉ đã là rộng với một
 *  đường hầm OpenVPN chỉ nhận vài chục route lẻ. Rộng hơn phải đo trước rồi mở
 *  bằng tay trên gateway, không cho tự động. */
export const MIN_PREFIX = 24

export type VpnDomainRow = { domain: string; enabled: boolean }

/** '10.121.124.155' -> true; 'jump.bitel.com.pe' -> false. */
export function isIpv4(s: string): boolean {
  const parts = s.trim().split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** '10.121.124.0/24' -> true. Chỉ nhận IPv4 CIDR. */
export function isIpv4Cidr(s: string): boolean {
  const [addr, bits, ...rest] = s.trim().split('/')
  if (rest.length || bits === undefined) return false
  const n = Number(bits)
  return isIpv4(addr) && Number.isInteger(n) && n >= 0 && n <= 32
}

export type RouteDecision =
  | { cidr: string; ok: true }
  | { input: string; ok: false; reason: 'not-ip' | 'too-broad' }

/**
 * Một dòng vpn_domains -> quyết định route. IP trần được coi là /32.
 * Trả cả lý do từ chối để UI/log nói được vì sao một mục không thành route.
 */
export function decideRoute(domain: string): RouteDecision {
  const s = (domain ?? '').trim()
  if (isIpv4(s)) return { cidr: `${s}/32`, ok: true }
  if (!isIpv4Cidr(s)) return { input: s, ok: false, reason: 'not-ip' }
  const prefix = Number(s.split('/')[1])
  if (prefix < MIN_PREFIX) return { input: s, ok: false, reason: 'too-broad' }
  return { cidr: s, ok: true }
}

/**
 * Danh sách CIDR để gateway quảng bá. Chỉ lấy mục đang BẬT — tắt toggle trên
 * dashboard là route bị rút, đúng như tắt một tên miền khỏi PAC.
 *
 * Thuần — unit-test được, không chạm DB.
 */
export function advertiseRoutesFromDomains(rows: VpnDomainRow[]): string[] {
  const out: string[] = []
  for (const r of rows) {
    if (!r.enabled) continue
    const d = decideRoute(r.domain)
    if (d.ok && !out.includes(d.cidr)) out.push(d.cidr)
  }
  return out
}

/** Dạng chuỗi cho `tailscale set --advertise-routes=` (rỗng = không quảng bá gì). */
export function advertiseRoutesString(rows: VpnDomainRow[]): string {
  return advertiseRoutesFromDomains(rows).join(',')
}
