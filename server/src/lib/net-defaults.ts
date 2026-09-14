import dns from 'node:dns'
import net from 'node:net'

/**
 * Mặc định mạng cho mọi kết nối đi ra (fetch/undici, net.connect).
 *
 * Sự cố 2026-09-14: login Google hỏng vì exchangeCode báo
 * `AggregateError [ETIMEDOUT] at internalConnectMultiple` chỉ ~258ms sau callback.
 * Node 22 bật "happy eyeballs" với mỗi lần thử chỉ 250ms; container vpn6 không có
 * đường IPv6 mà DNS lại trả IPv6 trước → chỉ còn IPv4, trễ nhẹ là hỏng cả lượt.
 * Ưu tiên IPv4 + nới thời gian mỗi lần thử lên 2s.
 */
export const AUTO_SELECT_ATTEMPT_TIMEOUT_MS = 2000

export function applyNetworkDefaults(): void {
  dns.setDefaultResultOrder('ipv4first')
  net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_ATTEMPT_TIMEOUT_MS)
}

applyNetworkDefaults()
