import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../env.js'

/**
 * Cửa duy nhất từ dashboard sang dịch vụ WhatsApp Task Agent.
 *
 * Dịch vụ đó sở hữu toàn bộ dữ liệu và logic, chỉ nghe loopback, và **không**
 * tự xác thực người dùng. Việc xác thực nằm ở đây: `requireAuth` xác minh phiên
 * đăng nhập, rồi route chuyển tiếp kèm danh tính đã xác minh trong header
 * `x-wa-agent-actor`. Dịch vụ đối chiếu danh tính đó với tài khoản duy nhất
 * được phép (FR-039a) — dashboard cho nhiều người đăng nhập, khu vực này thì không.
 *
 * Đây là **toàn bộ** phần chạm vào dashboard ở phía máy chủ. Thêm route thứ hai
 * nghĩa là logic nghiệp vụ đã rò sang repo này.
 *
 * Cổng: dịch vụ nghe 127.0.0.1:**8788**. Không phải 8787 — đó là cổng mặc định
 * của chính dashboard, hai bên chạy chung máy sẽ đụng nhau.
 */

/** Trần thời gian chờ. Dài hơn ngưỡng "tươi" 15 phút là vô nghĩa với widget. */
const TIMEOUT_MS = 15_000

/**
 * Vỏ bọc lỗi **đúng hình dạng dịch vụ trả về**.
 *
 * Khi dịch vụ chết, widget vẫn phải nhận đủ sáu trường để hiển thị trạng thái
 * lỗi thay vì rơi vào nhánh không định nghĩa — và tuyệt đối không được nhận
 * số 0 hay mảng rỗng, vì đó là nói dối về dữ liệu (FR-047, SC-025).
 */
function unavailableEnvelope(message: string) {
  return {
    state: 'error' as const,
    collectedAt: null,
    freshness: 'unknown' as const,
    serviceVersion: 'unknown',
    data: null,
    error: { code: 'service_unavailable', message },
  }
}

function targetUrl(req: FastifyRequest): string {
  const base = env.WA_AGENT_URL.replace(/\/$/, '')
  // Cắt tiền tố, giữ nguyên phần còn lại kể cả chuỗi truy vấn.
  const rest = req.url.slice('/api/whatsapp-agent'.length) || '/'
  return `${base}${rest}`
}

export async function whatsappAgentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.all('/api/whatsapp-agent/*', async (req, reply) => {
    const actor = req.user?.email ?? req.user?.username
    if (!actor) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'

    try {
      const upstream = await fetch(targetUrl(req), {
        method: req.method,
        headers: {
          'content-type': 'application/json',
          // Danh tính đã được xác thực ở dòng `requireAuth` phía trên. Header
          // này không phải bằng chứng xác thực — nó là lời khẳng định của bên
          // proxy, và chỉ đáng tin vì dịch vụ chỉ nghe loopback.
          'x-wa-agent-actor': actor,
        },
        body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })

      const text = await upstream.text()

      // Chuyển tiếp nguyên văn cả mã trạng thái lẫn thân: vỏ bọc do dịch vụ
      // dựng, dashboard không diễn giải lại. Diễn giải lại là chỗ hai bên bắt
      // đầu lệch nhau khi dịch vụ lên phiên bản mới (FR-048b).
      return reply
        .code(upstream.status)
        .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
        .send(text)
    } catch (e) {
      const reason =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'dịch vụ không phản hồi trong 15 giây'
          : 'không kết nối được tới dịch vụ WhatsApp Task Agent'

      // 503 kèm vỏ bọc đầy đủ. Không trả 500 rỗng: widget cần phân biệt "dịch
      // vụ chết" với "có dữ liệu nhưng rỗng".
      return reply.code(503).send(unavailableEnvelope(reason))
    }
  })
}
