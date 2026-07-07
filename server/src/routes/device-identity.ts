import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deviceIdentity } from '../db/schema.js'
import { env } from '../env.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'
import {
  staleNodesHoldingIp,
  upsertClientDevice,
} from '../lib/device-registry.js'

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
  ipAddresses?: string[]
  online?: boolean
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
      version?: unknown
      build?: unknown
      variant?: unknown
    }
    const mac = typeof body.mac === 'string' ? body.mac.trim().toLowerCase() : ''
    const hostname =
      typeof body.hostname === 'string' ? body.hostname.trim() : ''
    const nodeKey =
      typeof body.node_key === 'string' ? body.node_key.trim() : ''
    const ipv4 = typeof body.ipv4 === 'string' ? body.ipv4.trim() : ''
    const version =
      typeof body.version === 'string' ? body.version.trim() : ''
    const build =
      typeof body.build === 'number' && Number.isFinite(body.build)
        ? Math.trunc(body.build)
        : null
    const variant =
      typeof body.variant === 'string' ? body.variant.trim() : ''
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
      const versionChange = await upsertClientDevice({
        mac,
        hostname,
        nodeKey: nodeKey || null,
        ipv4: ipv4 || null,
        clientVersion: version || null,
        clientBuild: build,
        clientVariant: variant || null,
      })
      // Ghi log file server (docker logs) để tail/grep theo dõi nâng/hạ cấp.
      if (versionChange) {
        req.log.info(
          {
            hostname: versionChange.hostname,
            mac,
            fromBuild: versionChange.fromBuild,
            toBuild: versionChange.toBuild,
            direction: versionChange.direction,
            version,
          },
          `client version ${versionChange.direction}: ${versionChange.hostname} build ${versionChange.fromBuild ?? '-'} -> ${versionChange.toBuild}`
        )
      }

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
  // hint. DB LÀ NGUỒN THẬT của cặp MAC↔IP: trả staticIpv4 (admin gán, cố định
  // vĩnh viễn) ưu tiên, sau đó lastIpv4.
  //
  // Quan trọng — vì sao IP hay "trôi": mỗi lần client đăng ký lại thường tạo
  // node MỚI; node cũ (offline) vẫn GIỮ IP cũ, nên headscale không cấp lại
  // được IP đã pin → rơi sang IP khác. Để MAC↔IP cố định thật sự, ở đây ta
  // THU HỒI (xóa) node cũ CÙNG MÁY (khớp hostname) đang giữ IP đích trước khi
  // trả IP → headscale vừa gọi xong sẽ cấp đúng IP đó cho node mới. Chỉ xóa
  // node trùng hostname nên không bao giờ đụng máy khác. Best-effort: lỗi/dọn
  // không được thì vẫn trả IP, không chặn đăng ký.
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
          hostname: deviceIdentity.hostname,
        })
        .from(deviceIdentity)
        .where(eq(deviceIdentity.mac, mac))
      const ip = row?.staticIpv4 || row?.lastIpv4 || null
      if (ip && row?.hostname && (await isHsConfigured())) {
        try {
          const list = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
          const stale = staleNodesHoldingIp(ip, row.hostname, list.nodes ?? [])
          for (const id of stale) {
            await hsApi(`/api/v1/node/${encodeURIComponent(id)}`, {
              method: 'DELETE',
            })
          }
        } catch {
          // Dọn không được (headscale lỗi/timeout) → vẫn trả IP; headscale tự
          // fallback nếu IP còn bị chiếm. Không chặn đăng ký.
        }
      }
      return { ipv4: ip }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
