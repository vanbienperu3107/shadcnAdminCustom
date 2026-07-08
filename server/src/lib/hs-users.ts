/** headscale user record (chỉ các field cần để resolve id). Pure, không import gì. */
export type HsUserLite = {
  id?: string
  name?: string
  email?: string
  displayName?: string
}

/**
 * Map một định danh user (id số, tên đăng nhập, email, hoặc display name) sang
 * numeric id của headscale, tìm LOCAL trên toàn bộ danh sách user. Trả null nếu
 * không khớp.
 *
 * Dùng thay cho filter `?name=` của headscale: filter đó trả về RỖNG với user
 * OIDC có name là email (vd "user@gmail.com"), làm hỏng create/list/expire
 * pre-auth key cho đúng user sở hữu thiết bị. So khớp chính xác trước, rồi
 * fallback không phân biệt hoa/thường. Pure — unit-test không cần headscale.
 */
export function matchHsUserId(
  users: HsUserLite[],
  ident: string
): string | null {
  if (!ident) return null // tránh khớp nhầm user có name/email/displayName rỗng
  if (/^\d+$/.test(ident)) return ident
  const exact = users.find(
    (u) => u.name === ident || u.email === ident || u.displayName === ident
  )
  if (exact?.id) return exact.id
  const lc = ident.toLowerCase()
  const ci = users.find((u) =>
    [u.name, u.email, u.displayName].some((v) => v?.toLowerCase() === lc)
  )
  return ci?.id ?? null
}
