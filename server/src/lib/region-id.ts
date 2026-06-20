/**
 * Cấp region_id tự động, KHÔNG bao giờ trùng và KHÔNG bao giờ là 999 (embedded).
 * Dải dành cho node do user thêm: 1000..1099.
 */
export const EMBEDDED_REGION_ID = 999
export const USER_REGION_MIN = 1000
export const USER_REGION_MAX = 1099

/**
 * Trả về region_id mới = max(các id đang dùng trong dải) + 1 (kiểu "tự tăng" như UI).
 * Nếu vượt trần thì lùi về tìm khe trống thấp nhất. Bỏ qua 999.
 */
export function nextRegionId(usedIds: number[]): number {
  const used = new Set(usedIds)
  const inRange = usedIds.filter((id) => id >= USER_REGION_MIN && id <= USER_REGION_MAX)
  let next = (inRange.length ? Math.max(...inRange) : USER_REGION_MIN - 1) + 1
  if (next === EMBEDDED_REGION_ID) next++
  if (next <= USER_REGION_MAX && !used.has(next)) return next
  // Hết "đuôi" hoặc trùng → tìm khe trống thấp nhất trong dải.
  for (let id = USER_REGION_MIN; id <= USER_REGION_MAX; id++) {
    if (id === EMBEDDED_REGION_ID) continue
    if (!used.has(id)) return id
  }
  throw new Error(`Không còn region_id trống trong dải ${USER_REGION_MIN}-${USER_REGION_MAX}`)
}

/** region_id user nhập/sửa có hợp lệ không (không đụng 999, nằm trong dải). */
export function isValidUserRegionId(id: number): boolean {
  return Number.isInteger(id) && id >= USER_REGION_MIN && id <= USER_REGION_MAX && id !== EMBEDDED_REGION_ID
}
