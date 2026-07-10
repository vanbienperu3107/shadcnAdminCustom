import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { deviceEnrollment, deviceIdentity } from '../db/schema.js'
import { env } from '../env.js'
import {
  adoptStatus,
  normalizeSalt,
  type EnrollStatus,
} from '../lib/enrollment.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'
import {
  isCiRunnerHostname,
  pickReservedIp,
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
 * Thu hồi (xoá) mọi node CÙNG MÁY, OFFLINE, đang giữ `ip` đích — để lần đăng
 * ký sau headscale cấp lại đúng IP pin. Best-effort. QUAN TRỌNG: hàm này gọi
 * ngược headscale (list + delete node), nên PHẢI chạy NGOÀI đường phản hồi của
 * /api/internal/reserved-ip (fire-and-forget) — xem lý do chi tiết ở nơi gọi.
 */
async function reapStaleNodesHoldingIp(
  ip: string,
  hostname: string
): Promise<void> {
  if (!(await isHsConfigured())) return
  const list = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
  const stale = staleNodesHoldingIp(ip, hostname, list.nodes ?? [])
  for (const id of stale) {
    await hsApi(`/api/v1/node/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}

/**
 * Auto-adopt (zero-touch): một máy vừa đăng nhập OIDC thành công tự được ghi 1
 * dòng device_enrollment 'approved', để LẦN SAU nó (hoặc chính nó sau khi xoá
 * state / cài lại) tự vào tailnet không cần cấu hình gì — client sẽ probe
 * /api/internal/enroll?probe=1 với (mac, salt) và nhận ngay authKey.
 *
 * HÀNG RÀO: chỉ adopt khi nodeKey client báo THỰC SỰ tồn tại trên headscale —
 * tức máy đó đã đăng ký hợp lệ. Chặn kẻ chỉ biết (mac, salt) tự tạo dòng
 * approved cho máy chưa từng login. KHÔNG bao giờ dựng dậy dòng 'revoked'
 * (adoptStatus). Best-effort: mọi lỗi ở đây chỉ log, không được làm hỏng
 * device-register (kết nối của máy quan trọng hơn tiện ích adopt).
 */
async function adoptEnrollmentAfterLogin(
  mac: string,
  salt: string,
  hostname: string,
  nodeKey: string,
  ipv4: string
): Promise<void> {
  if (!salt || !nodeKey) return
  if (!(await isHsConfigured())) return

  const list = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
  const nodeExists = (list.nodes ?? []).some((n) => n.nodeKey === nodeKey)
  if (!nodeExists) return // máy chưa thực sự là node hợp lệ → không adopt

  const [row] = await db
    .select()
    .from(deviceEnrollment)
    .where(and(eq(deviceEnrollment.mac, mac), eq(deviceEnrollment.salt, salt)))

  const status = adoptStatus((row?.status as EnrollStatus | undefined) ?? null)

  if (!row) {
    await db.insert(deviceEnrollment).values({
      mac,
      salt,
      status,
      hostname: hostname || null,
      pinnedIpv4: ipv4 || null,
      approvedAt: new Date(),
      approvedBy: 'auto-oidc',
    })
    return
  }

  // Chỉ đóng dấu approved lần ĐẦU chuyển sang approved (giữ audit chính xác);
  // không ghi đè pinnedIpv4 admin đã đặt.
  const becomingApproved = row.status !== 'approved' && status === 'approved'
  await db
    .update(deviceEnrollment)
    .set({
      status,
      hostname: hostname || row.hostname,
      pinnedIpv4: row.pinnedIpv4 ?? (ipv4 || null),
      ...(becomingApproved
        ? { approvedAt: new Date(), approvedBy: 'auto-oidc' }
        : {}),
    })
    .where(eq(deviceEnrollment.id, row.id))
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
      salt?: unknown
    }
    const mac = typeof body.mac === 'string' ? body.mac.trim().toLowerCase() : ''
    // salt = serial ổ đĩa đã chuẩn hoá (client mới gửi kèm). Có ⇒ auto-adopt.
    const salt = typeof body.salt === 'string' ? normalizeSalt(body.salt) : ''
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

    // Bỏ qua máy runner CI (GitHub Actions smoke-test tự chạy launcher →
    // device-register). Không lưu để không tạo dòng device_identity rác mỗi
    // lần build (vd "runnervmuktm0"). Trả 200 để CI không coi là lỗi.
    if (isCiRunnerHostname(hostname)) {
      return { ok: true, skipped: 'ci-runner' }
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

      // Auto-adopt: máy vừa login OIDC + có gửi salt ⇒ ghi 'approved' để lần
      // sau tự vào không cần cấu hình. Best-effort, không chặn device-register.
      if (salt) {
        try {
          await adoptEnrollmentAfterLogin(mac, salt, hostname, nodeKey, ipv4)
        } catch (e) {
          req.log.warn(
            { err: e instanceof Error ? e.message : String(e), mac },
            'device-register: auto-adopt enrollment failed'
          )
        }
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
    const q = req.query as { mac?: string; pin?: string }
    const mac = typeof q.mac === 'string' ? q.mac.trim().toLowerCase() : ''
    if (!mac) return reply.code(400).send({ error: 'mac required' })
    // pin=1: chế độ cho headscale reconcile tất định (plan IP-pin consistency, khi
    // derp.pin_reconcile.mode=on). Khác luồng cũ ở 2 điểm:
    //   (B2) CHỈ trả static_ipv4 (admin ghim) — KHÔNG fallback last_ipv4 (IP trôi),
    //        null khi chưa ghim → headscale đi nhánh CHEAP (không đổi IP).
    //   (B1) KHÔNG bắn reap async — headscale reconcile là nguồn xoá node DUY NHẤT,
    //        2 bộ xoá cùng chạy sẽ đua (có thể nhả pin của node vừa tạo).
    // Không pin=1 → giữ NGUYÊN hành vi cũ (static||last + reap) để tương thích ngược
    // trong cửa sổ deploy (headscale cũ chưa gửi pin=1).
    const pinMode = q.pin === '1'
    try {
      const [row] = await db
        .select({
          staticIpv4: deviceIdentity.staticIpv4,
          lastIpv4: deviceIdentity.lastIpv4,
          hostname: deviceIdentity.hostname,
        })
        .from(deviceIdentity)
        .where(eq(deviceIdentity.mac, mac))
      if (pinMode) {
        // static-only, không reap (headscale reconcile là nguồn xoá node duy nhất).
        return { ipv4: pickReservedIp(row, true) }
      }
      const ip = pickReservedIp(row, false)
      // Thu hồi node rác giữ IP đích, nhưng KHÔNG await: headscale gọi endpoint
      // này ĐỒNG BỘ trong lúc cấp IP cho node đang đăng ký, chặn bởi timeout
      // ngắn (~500ms). List+delete node headscale ở đây (gọi ngược vào headscale
      // giữa lúc nó đang đăng ký) vượt ngân sách đó → "context deadline
      // exceeded" → headscale fallback cấp IP tuần tự → node TRÔI khỏi IP pin
      // (itop rơi xuống .19 thay vì .17, mất luôn nodeAttr drive:share). Chạy
      // nền để trả IP pin ngay lập tức; lần đăng ký sau IP đã được dọn sẵn.
      if (ip && row?.hostname) {
        void reapStaleNodesHoldingIp(ip, row.hostname).catch((e) => {
          app.log.warn(
            { err: e instanceof Error ? e.message : String(e), mac },
            'reserved-ip: background stale-node reap failed'
          )
        })
      }
      return { ipv4: ip }
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
