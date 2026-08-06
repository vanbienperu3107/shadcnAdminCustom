import { api } from '@/lib/api-client'

/**
 * Client gọi dịch vụ WhatsApp Task Agent qua route proxy đã xác thực.
 *
 * Dữ liệu và logic nằm hết ở dịch vụ (repo riêng). Thư mục này chỉ hiển thị.
 *
 * Điều quan trọng nhất ở đây là **không được làm phẳng vỏ bọc**. Dịch vụ phân
 * biệt ba tình huống, và giao diện phải giữ nguyên sự phân biệt đó:
 *
 * - `ok`    — có dữ liệu, kèm mốc thu thập và độ tươi.
 * - `empty` — truy vấn chạy được, kết quả đúng bằng không. Đây là sự thật.
 * - `error` — không lấy được. `data` luôn `null`.
 *
 * Biến `empty` và `error` thành cùng một mảng rỗng là cách dashboard hiển thị
 * "0 nhiệm vụ" trong khi dịch vụ đang chết. Toàn bộ tầng này tồn tại để điều đó
 * không xảy ra được.
 */

const PREFIX = '/whatsapp-agent'

export type Freshness = 'fresh' | 'stale' | 'unknown'

export type AgentErrorCode =
  | 'service_unavailable'
  | 'whatsapp_disconnected'
  | 'llm_unavailable'
  | 'gtasks_unauthorized'
  | 'db_error'
  | 'not_found'
  | 'invalid_state'
  | 'forbidden'

export type Envelope<T> = {
  state: 'ok' | 'empty' | 'error'
  collectedAt: string | null
  freshness: Freshness
  serviceVersion: string
  data: T | null
  error: { code: AgentErrorCode; message: string } | null
}

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/**
 * Gọi một endpoint và trả về **nguyên vỏ bọc**.
 *
 * Không ném lỗi khi `state === 'error'`: mỗi widget tự quyết định hiển thị thế
 * nào, và nhiều widget cần biết cả `serviceVersion` lẫn `collectedAt` ngay cả
 * trong trạng thái lỗi.
 *
 * Lỗi mạng thuần tuý (proxy chết, mất kết nối) cũng được gói lại thành cùng
 * hình dạng, để widget chỉ phải xử lý một kiểu dữ liệu.
 */
export async function fetchEnvelope<T>(path: string): Promise<Envelope<T>> {
  try {
    const { data } = await api.get<Envelope<T>>(`${PREFIX}${path}`)
    return data
  } catch (e) {
    const fallback = (e as { response?: { data?: Envelope<T> } }).response?.data
    // Route proxy đã trả đúng vỏ bọc khi dịch vụ chết; dùng lại nếu có.
    if (fallback && typeof fallback === 'object' && 'state' in fallback) {
      return fallback
    }
    return {
      state: 'error',
      collectedAt: null,
      freshness: 'unknown',
      serviceVersion: 'unknown',
      data: null,
      error: { code: 'service_unavailable', message: 'không gọi được dịch vụ' },
    }
  }
}

/**
 * Dùng cho thao tác ghi, nơi lỗi **nên** ném ra để react-query đưa vào nhánh
 * `onError` và giao diện báo hỏng thay vì im lặng.
 */
export async function mutateAgent<T>(
  method: 'post' | 'patch' | 'put',
  path: string,
  body?: unknown
): Promise<T> {
  const { data } = await api[method]<Envelope<T>>(
    `${PREFIX}${path}`,
    body ?? {}
  )

  if (data.state === 'error') {
    throw new AgentError(
      data.error?.code ?? 'service_unavailable',
      data.error?.message ?? 'lỗi'
    )
  }
  if (data.data === null) {
    throw new AgentError('invalid_state', 'dịch vụ không trả về dữ liệu')
  }
  return data.data
}

/** Khoá query — mỗi widget một khoá riêng vì mỗi widget một lời gọi riêng. */
export const agentKeys = {
  connection: ['wa-agent', 'widget', 'connection'] as const,
  approvalQueue: ['wa-agent', 'widget', 'approval-queue'] as const,
  dataGaps: ['wa-agent', 'widget', 'data-gaps'] as const,
  backlog: ['wa-agent', 'widget', 'backlog'] as const,
  topicProposals: ['wa-agent', 'widget', 'topic-proposals'] as const,
  deletingGroups: ['wa-agent', 'widget', 'deleting-groups'] as const,
  version: ['wa-agent', 'widget', 'version'] as const,
  evaluationProgress: ['wa-agent', 'widget', 'evaluation-progress'] as const,
  llmUsage: ['wa-agent', 'widget', 'llm-usage'] as const,
  setupStatus: ['wa-agent', 'setup', 'status'] as const,
  groups: ['wa-agent', 'groups'] as const,
  tasks: (filters: Record<string, unknown>) =>
    ['wa-agent', 'tasks', filters] as const,
  settings: ['wa-agent', 'settings'] as const,
}

// ── Widget ───────────────────────────────────────────────────────────────────
//
// Mỗi widget một hàm, một endpoint, một khoá query. Cố tình **không** có hàm
// gộp nhiều widget: một widget hỏng không được kéo widget khác (FR-046).

export type ConnectionWidget = {
  state: 'connected' | 'disconnected' | 'needs_relink'
  lastConnectedAt: string | null
  disconnectedSince: string | null
  needsRelink: boolean
  consecutiveRelinkFailures: number
}

export const fetchConnection = () =>
  fetchEnvelope<ConnectionWidget>('/widgets/connection')

export type ApprovalQueueWidget = {
  total: number
  byReason: {
    lowConfidence: number
    groupBroadcast: number
    selfCommitment: number
  }
  oldestQueuedAt: string | null
  /**
   * `false` khi chưa có bề mặt duyệt nào (FR-027g). Giao diện phải nói rõ nhiệm
   * vụ đang được giữ vô thời hạn — **không** hiển thị đếm ngược hết hạn.
   */
  expiryClockRunning: boolean
}

export const fetchApprovalQueue = () =>
  fetchEnvelope<ApprovalQueueWidget>('/widgets/approval-queue')

export type DataGapsWidget = {
  total: number
  unacknowledged: number
  gaps: { groupName: string; gapStart: string; gapEnd: string; cause: string }[]
}

export const fetchDataGaps = () =>
  fetchEnvelope<DataGapsWidget>('/widgets/data-gaps')

export type BacklogWidget = {
  pendingMessages: number
  pendingJobs: number
  capReachedAt: string | null
  estimatedResumeAt: string | null
}

export const fetchBacklog = () =>
  fetchEnvelope<BacklogWidget>('/widgets/backlog')

export type VersionWidget = { service: string; schema: string }

export const fetchVersion = () =>
  fetchEnvelope<VersionWidget>('/widgets/version')

export type LlmUsageWidget = {
  today: {
    calls: number
    inputTokens: number
    outputTokens: number
    work: number
    sampling: number
  }
  dailyCap: number
  capUtilization: number
}

export const fetchLlmUsage = () =>
  fetchEnvelope<LlmUsageWidget>('/widgets/llm-usage')
