/**
 * Sức khoẻ của một VPN gateway, suy từ trạng thái agent báo về + độ trễ báo cáo.
 * Dùng cho cảnh báo "phiên VPN rớt": agent POST /api/vpn/agent/status mỗi ~30s;
 * im lặng quá STALE_MS coi như node/agent chết dù trạng thái cuối là 'up'.
 */

export type GwHealthInput = {
  enabled: boolean
  desiredState: string
  state: string | null
  reportedAt: Date | string | null
}

export type GwHealthStatus =
  | 'healthy'      // agent báo 'up' và còn mới
  | 'connecting'   // đang bắt tay VPN
  | 'down'         // agent báo 'down'/'error'
  | 'stale'        // agent im lặng quá lâu (node/agent có thể đã chết)
  | 'stopped'      // admin tắt (desired_state=down hoặc gateway disabled)
  | 'unknown'      // chưa có báo cáo nào

export type GwHealth = { status: GwHealthStatus; ageSec: number | null }

/** Agent báo ~30s/lần; im lặng > 120s (4 chu kỳ) coi là stale. */
export const STALE_MS = 120_000

export function computeGatewayHealth(g: GwHealthInput, nowMs: number): GwHealth {
  const reported = g.reportedAt ? new Date(g.reportedAt).getTime() : null
  const ageSec =
    reported != null ? Math.max(0, Math.round((nowMs - reported) / 1000)) : null

  // Admin chủ động tắt -> không cảnh báo.
  if (!g.enabled || g.desiredState === 'down') {
    return { status: 'stopped', ageSec }
  }
  if (reported == null) return { status: 'unknown', ageSec: null }
  if (nowMs - reported > STALE_MS) return { status: 'stale', ageSec }

  switch (g.state) {
    case 'up':
      return { status: 'healthy', ageSec }
    case 'connecting':
      return { status: 'connecting', ageSec }
    case 'down':
    case 'error':
      return { status: 'down', ageSec }
    default:
      return { status: 'unknown', ageSec }
  }
}

/** Cần cảnh báo (đỏ) hay không — tiện cho UI/summary. */
export function isGatewayAlerting(h: GwHealth): boolean {
  return h.status === 'down' || h.status === 'stale'
}
