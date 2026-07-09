import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Zero-touch enrollment — logic thuần (không chạm DB/mạng) để unit-test được.
 *
 * Luồng: client (tailscale_mod) POST /api/internal/enroll {mac, salt, hostname,
 * token?}. Server tra bảng device_enrollment theo (mac, salt) rồi quyết định:
 * tạo dòng pending / bảo chờ duyệt / cấp authKey / từ chối.
 *
 * `salt` là serial ổ đĩa đã chuẩn hoá — CHÍNH LÀ giá trị seed machine key phía
 * client (cmd/tailscaled/hwid.go). Hai bên phải chuẩn hoá GIỐNG HỆT nhau, nếu
 * lệch 1 ký tự thì client sinh machine key khác ⇒ headscale coi là node mới ⇒
 * trôi IP. Vì vậy normalizeSalt() phải là bản sao chính xác của normalizeSerial().
 */

/** TTL của pre-auth key cấp cho 1 lần enroll. Ngắn: dùng ngay rồi vứt. */
export const PREAUTH_TTL_MS = 10 * 60 * 1000

/** Trần số dòng `pending` — chống spam endpoint public tạo dòng vô hạn. */
export const MAX_PENDING_ROWS = 200

/**
 * Chuẩn hoá serial phần cứng. PHẢI khớp normalizeSerial() của client:
 * trim 2 đầu, gộp mọi cụm whitespace thành 1 space, viết hoa.
 */
export function normalizeSalt(raw: string): string {
  return raw.trim().split(/\s+/).filter(Boolean).join(' ').toUpperCase()
}

/** MAC chuẩn hoá về lowercase/trim — khớp cách device_identity lưu. */
export function normalizeMac(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Sinh device token ngẫu nhiên 32 byte (chỉ trả về client ĐÚNG 1 lần). */
export function newDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Băm device token để lưu DB — không bao giờ lưu bản rõ. */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** So sánh hash hằng-thời-gian (chống timing oracle trên endpoint public). */
export function deviceTokenMatches(supplied: string, storedHash: string): boolean {
  if (!supplied || !storedHash) return false
  const a = Buffer.from(hashDeviceToken(supplied), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/**
 * Thời điểm hết hạn pre-auth key, LUÔN tường minh.
 *
 * BẪY ZERO-TIME (headscale grpcv1.go:155-158 + types/preauth_key.go:79): request
 * tạo key KHÔNG kèm `expiration` sẽ nhận expiration = zero-time, và
 * PreAuthKey.Validate() coi zero-time là ĐÃ HẾT HẠN ⇒ key vô dụng ngay khi tạo.
 * Vì vậy mọi lời gọi mint đều phải đi qua hàm này.
 */
export function preAuthKeyExpiration(now: Date, ttlMs: number = PREAUTH_TTL_MS): string {
  return new Date(now.getTime() + ttlMs).toISOString()
}

export type EnrollStatus = 'pending' | 'approved' | 'revoked'

/** Phần bản ghi device_enrollment mà state machine cần. */
export type EnrollRow = {
  status: EnrollStatus
  deviceTokenHash: string | null
}

/**
 * Quyết định của state machine:
 *  - create-pending: chưa có dòng → tạo mới, trả 202.
 *  - pending: đang chờ admin duyệt → 202.
 *  - issue(mintToken=true): đã duyệt, CHƯA từng enroll → cấp key + phát token
 *    (first-enroll-wins: ai đến trước chiếm thiết bị).
 *  - issue(mintToken=false): đã duyệt, token khớp → cấp key, KHÔNG phát token mới.
 *  - denied: revoked, hoặc thiếu/sai token → 403, client dừng hẳn.
 */
export type EnrollDecision =
  | { kind: 'create-pending' }
  | { kind: 'pending' }
  | { kind: 'issue'; mintToken: boolean }
  | { kind: 'denied'; reason: 'revoked' | 'token_required' | 'token_mismatch' }

export function enrollDecision(
  row: EnrollRow | null,
  suppliedToken: string
): EnrollDecision {
  if (!row) return { kind: 'create-pending' }
  if (row.status === 'revoked') return { kind: 'denied', reason: 'revoked' }
  if (row.status === 'pending') return { kind: 'pending' }

  // status === 'approved'
  if (!row.deviceTokenHash) {
    // Cửa sổ first-enroll-wins: từ lúc admin duyệt đến lần enroll đầu tiên.
    return { kind: 'issue', mintToken: true }
  }
  if (!suppliedToken) return { kind: 'denied', reason: 'token_required' }
  if (!deviceTokenMatches(suppliedToken, row.deviceTokenHash)) {
    return { kind: 'denied', reason: 'token_mismatch' }
  }
  return { kind: 'issue', mintToken: false }
}

/** Che salt khi trả về UI — serial suy ra được private machine key. */
export function maskSalt(salt: string): string {
  if (salt.length <= 4) return '••••'
  return `${salt.slice(0, 2)}••••${salt.slice(-2)}`
}
