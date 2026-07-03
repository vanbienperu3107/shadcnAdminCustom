import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deviceIdentity } from '../db/schema.js'
import { env } from '../env.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'

function checkSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.HEADSCALE_DASHBOARD_SECRET) return true
  if (req.headers['x-headscale-secret'] === env.HEADSCALE_DASHBOARD_SECRET)
    return true
  reply.code(401).send({ error: 'unauthorized' })
  return false
}

type HsNode = {
  id?: string
  nodeKey?: string
  givenName?: string
  name?: string
}

/**
 * Public — gọi bởi client (nodemode.go) ngay sau khi `tailscale up` thành
 * công, báo (mac, hostname, nodeKey). Lần đầu thấy 1 MAC → hostname báo về
 * trở thành tên chuẩn, lưu vào device_identity. Lần sau nếu node báo hostname
 * KHÁC tên chuẩn đã lưu (cài lại/đổi tên OS) → tự đổi node hiện tại (theo
 * nodeKey mới) về ĐÚNG tên chuẩn cũ qua headscale rename API — không tạo tên
 * mới, tránh dedup phải xử lý (user, hostname) trùng lặp.
 */
export async function deviceIdentityPublicRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post('/api/internal/device-register', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const body = req.body as {
      mac?: unknown
      hostname?: unknown
      node_key?: unknown
    }
    const mac = typeof body.mac === 'string' ? body.mac.trim().toLowerCase() : ''
    const hostname =
      typeof body.hostname === 'string' ? body.hostname.trim() : ''
    const nodeKey =
      typeof body.node_key === 'string' ? body.node_key.trim() : ''
    if (!mac || !hostname) {
      return reply.code(400).send({ error: 'mac and hostname required' })
    }

    try {
      const [existing] = await db
        .select()
        .from(deviceIdentity)
        .where(eq(deviceIdentity.mac, mac))

      if (!existing) {
        await db.insert(deviceIdentity).values({
          mac,
          hostname,
          nodeKey: nodeKey || null,
          updatedAt: new Date(),
        })
        return { ok: true, canonicalHostname: hostname, renamed: false }
      }

      // MAC đã biết — cập nhật nodeKey mới nhất (đổi mỗi lần cài lại).
      if (existing.nodeKey !== nodeKey) {
        await db
          .update(deviceIdentity)
          .set({ nodeKey: nodeKey || null, updatedAt: new Date() })
          .where(eq(deviceIdentity.mac, mac))
      }

      // Tên khớp tên chuẩn — không cần làm gì thêm.
      if (existing.hostname === hostname) {
        return { ok: true, canonicalHostname: hostname, renamed: false }
      }

      // Tên khác tên chuẩn đã lưu — thử đổi tên node hiện tại về tên chuẩn.
      // Best-effort: nếu headscale không cấu hình hoặc không tìm thấy node
      // (nodeKey chưa kịp propagate), vẫn trả 200 để client không retry-loop.
      if (nodeKey && (await isHsConfigured())) {
        try {
          const list = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
          const node = (list.nodes ?? []).find((n) => n.nodeKey === nodeKey)
          if (node?.id) {
            await hsApi(
              `/api/v1/node/${encodeURIComponent(node.id)}/rename/${encodeURIComponent(existing.hostname)}`,
              { method: 'POST' }
            )
            return {
              ok: true,
              canonicalHostname: existing.hostname,
              renamed: true,
            }
          }
        } catch {
          // Không rename được thì bỏ qua — không chặn node hoạt động.
        }
      }

      return { ok: true, canonicalHostname: existing.hostname, renamed: false }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
