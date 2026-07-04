import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deviceIdentity } from '../db/schema.js'
import { env } from '../env.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'
import { upsertClientDevice } from '../lib/device-registry.js'

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
      ipv4?: unknown
    }
    const mac = typeof body.mac === 'string' ? body.mac.trim().toLowerCase() : ''
    const hostname =
      typeof body.hostname === 'string' ? body.hostname.trim() : ''
    const nodeKey =
      typeof body.node_key === 'string' ? body.node_key.trim() : ''
    const ipv4 = typeof body.ipv4 === 'string' ? body.ipv4.trim() : ''
    if (!mac || !hostname) {
      return reply.code(400).send({ error: 'mac and hostname required' })
    }

    try {
      const [existing] = await db
        .select()
        .from(deviceIdentity)
        .where(eq(deviceIdentity.mac, mac))

      // upsertClientDevice() chỉ set hostname lúc INSERT lần đầu — nếu đã có
      // dòng cũ, hostname (tên chuẩn) không bị ghi đè, chỉ nodeKey/lastIpv4
      // được cập nhật (xem lib/device-registry.ts).
      await upsertClientDevice({
        mac,
        hostname,
        nodeKey: nodeKey || null,
        ipv4: ipv4 || null,
      })

      if (!existing) {
        return { ok: true, canonicalHostname: hostname, renamed: false }
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

  // Public — gọi bởi headscale fork lúc đăng ký node MỚI (state.go, ngay
  // trước ipAlloc.Next()), đọc Hostinfo.WoLMACs[0] client gửi lên làm MAC
  // hint. Trả IP nên dùng (ưu tiên staticIpv4 admin gán tay, sau đó lastIpv4
  // lịch sử tự động) — headscale tự quyết định fallback nếu IP đã bị chiếm
  // hoặc endpoint này lỗi/timeout, KHÔNG chặn đăng ký trong mọi trường hợp.
  app.get('/api/internal/reserved-ip', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const q = req.query as { mac?: string }
    const mac = typeof q.mac === 'string' ? q.mac.trim().toLowerCase() : ''
    if (!mac) return reply.code(400).send({ error: 'mac required' })
    try {
      const [row] = await db
        .select({
          staticIpv4: deviceIdentity.staticIpv4,
          lastIpv4: deviceIdentity.lastIpv4,
        })
        .from(deviceIdentity)
        .where(eq(deviceIdentity.mac, mac))
      return { ipv4: row?.staticIpv4 || row?.lastIpv4 || null }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
