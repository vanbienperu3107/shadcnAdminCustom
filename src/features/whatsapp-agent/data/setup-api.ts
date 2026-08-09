import { api } from '@/lib/api-client'
import { type Envelope, AgentError } from './agent-api'

/**
 * Liên kết WhatsApp bằng **mã ghép nối 8 ký tự**, không phải mã QR.
 *
 * Dịch vụ chạy headless trên máy chủ còn dashboard ở xa, nên đẩy một mã QR đổi
 * 20 giây một lần qua route proxy chỉ để người dùng giơ điện thoại lên màn hình
 * là phức tạp không cần thiết. Mã ghép nối sống lâu hơn và gõ tay được.
 */

const PREFIX = '/whatsapp-agent'

export type SetupStep = {
  step: string
  done: boolean
}

export type SetupStatus = {
  required: SetupStep[]
  optional: SetupStep[]
  isFirstRun: boolean
}

export type PairingResult = {
  pairingCode: string
  instructions: string
}

export async function fetchSetupStatus(): Promise<Envelope<SetupStatus>> {
  const { data } = await api.get<Envelope<SetupStatus>>(
    `${PREFIX}/setup/status`
  )
  return data
}

/**
 * Xin mã ghép nối.
 *
 * Ném lỗi khi dịch vụ từ chối — người dùng cần thấy lý do ngay (ví dụ: thiết bị
 * đã liên kết rồi), không phải một màn hình im lặng.
 *
 * **Không lưu mã vào bất kỳ đâu.** Nó chỉ sống trong state của màn hình cho tới
 * khi ghép nối xong: trong thời gian còn hiệu lực, ai có mã cũng gắn được thiết
 * bị của họ vào tài khoản này.
 */
export async function requestPairingCode(
  phoneNumber: string
): Promise<PairingResult> {
  const { data } = await api.post<Envelope<PairingResult>>(
    `${PREFIX}/setup/link`,
    { phoneNumber }
  )

  if (data.state === 'error' || data.data === null) {
    throw new AgentError(
      data.error?.code ?? 'service_unavailable',
      data.error?.message ?? 'không xin được mã ghép nối'
    )
  }

  return data.data
}

/**
 * Bỏ mọi ký tự không phải số.
 *
 * Dịch vụ cũng làm lại bước này — đây chỉ để hiển thị và để chặn nút khi
 * người dùng chưa gõ đủ số.
 */
export function normalizePhoneNumber(input: string): string {
  return input.replace(/\D/g, '')
}
