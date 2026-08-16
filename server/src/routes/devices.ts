import type { FastifyInstance } from 'fastify'
import { and, eq, isNotNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { clientHomeDerp, deviceIdentity } from '../db/schema.js'
import {
  backfillDeviceRegistry,
  normalizeNodeKey,
  resolveDeviceLiveState,
} from '../lib/device-registry.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'

const patchSchema = z.object({
  managedUser: z.string().nullish(),
  staticIpv4: z.string().nullish(),
})

/**
 * Bản đồ nodeKey -> online của headscale, CACHE NGẮN.
 *
 * /api/devices/live được poll 1s/lần từ trình duyệt; gọi thẳng headscale mỗi
 * lần sẽ nện API 1 req/s. Cache 5s giữ độ trễ phát hiện online/offline ở mức
 * chấp nhận được (headscale cũng chỉ đổi trạng thái khi map-poll mở/đóng) mà
 * chỉ tốn ~0.2 req/s.
 *
 * Best-effort: headscale chưa cấu hình hoặc lỗi -> trả null, caller rơi về
 * "chỉ dựa telemetry" (hành vi cũ), KHÔNG làm hỏng endpoint.
 */
type HsNodeLite = { nodeKey?: string; online?: boolean }
const HS_ONLINE_CACHE_MS = 5_000
let hsOnlineCache: { at: number; byNodeKey: Map<string, boolean> } | null = null

async function headscaleOnlineByNodeKey(
  nowMs: number
): Promise<Map<string, boolean> | null> {
  if (hsOnlineCache && nowMs - hsOnlineCache.at < HS_ONLINE_CACHE_MS) {
    return hsOnlineCache.byNodeKey
  }
  if (!(await isHsConfigured())) return null
  const list = await hsApi<{ nodes?: HsNodeLite[] }>('/api/v1/node')
  const byNodeKey = new Map<string, boolean>()
  for (const n of list.nodes ?? []) {
    const key = normalizeNodeKey(n.nodeKey)
    // Node có thể xuất hiện nhiều lần (đăng ký lại) — chỉ cần MỘT node online
    // là máy đó online.
    if (key) byNodeKey.set(key, (byNodeKey.get(key) ?? false) || !!n.online)
  }
  hsOnlineCache = { at: nowMs, byNodeKey }
  return byNodeKey
}

/**
 * Admin — device registry hợp nhất (client + derp_infra), xem
 * lib/device-registry.ts. Dùng để frontend phân loại machine thay vì đoán
 * qua tên (derpNameSet/isDerpNode).
 */
export async function devicesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/devices', async () => {
    const rows = await db
      .select({
        id: deviceIdentity.id,
        mac: deviceIdentity.mac,
        nodeKey: deviceIdentity.nodeKey,
        hostname: deviceIdentity.hostname,
        managedUser: deviceIdentity.managedUser,
        deviceType: deviceIdentity.deviceType,
        lastIpv4: deviceIdentity.lastIpv4,
        staticIpv4: deviceIdentity.staticIpv4,
        clientVersion: deviceIdentity.clientVersion,
        clientBuild: deviceIdentity.clientBuild,
        clientVariant: deviceIdentity.clientVariant,
        updatedAt: deviceIdentity.updatedAt,
      })
      .from(deviceIdentity)
    return rows
  })

  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db
      .update(deviceIdentity)
      .set({
        ...(parsed.data.managedUser !== undefined && {
          managedUser: parsed.data.managedUser,
        }),
        ...(parsed.data.staticIpv4 !== undefined && {
          staticIpv4: parsed.data.staticIpv4,
        }),
        updatedAt: new Date(),
      })
      .where(eq(deviceIdentity.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return row
  })

  // Màn hình Machines realtime (poll 1s). MAC | Name | IP | Version | State |
  // Last seen. IP = static_ipv4 (admin gán) ưu tiên, sau đó last_ipv4.
  //
  // TRẠNG THÁI = OR của hai tín hiệu độc lập (xem resolveDeviceLiveState):
  //   - telemetry trong DB (client_home_derp, client mod báo ~3s/lần)
  //   - headscale còn giữ map-poll mở với node (cache 5s, best-effort)
  //
  // Trước đây chỉ dựa telemetry và coi "không báo cáo" == "offline". Sai: đã
  // gặp máy chạy bình thường, headscale báo Connected 32h liền, nhưng reporter
  // chốt MAC rỗng lúc khởi động nên mọi POST telemetry bị 400 -> dashboard báo
  // Offline. Giờ máy đó hiện ONLINE + cờ `reporting=false` để admin thấy đúng
  // bản chất: máy sống, telemetry hỏng.
  app.get('/api/devices/live', async () => {
    const devs = await db
      .select({
        id: deviceIdentity.id,
        mac: deviceIdentity.mac,
        nodeKey: deviceIdentity.nodeKey,
        hostname: deviceIdentity.hostname,
        lastIpv4: deviceIdentity.lastIpv4,
        staticIpv4: deviceIdentity.staticIpv4,
        clientVersion: deviceIdentity.clientVersion,
        clientBuild: deviceIdentity.clientBuild,
        clientVariant: deviceIdentity.clientVariant,
        deviceType: deviceIdentity.deviceType,
        updatedAt: deviceIdentity.updatedAt,
      })
      .from(deviceIdentity)
      .where(
        and(
          // Tab "Nguoi dung" CHI hien may cua nguoi dung. Node ha tang DERP
          // (vpn4-vn-1 / vpn6-vn-1) da co tab "Ha tang DERP" rieng — tung thu bo
          // loc nay de 2 node native hien ra, ket qua la chung hien o CA HAI tab.
          // Cai can sua luc do la DU LIEU (client mod chua bao cao), khong phai bo loc.
          eq(deviceIdentity.deviceType, 'client'),
          // Bo dong VO DANH: khong mac, khong node_key thi khong dinh danh duoc
          // may nao ca. Chung sinh ra khi client dang ky lai ma chua kip gui MAC,
          // moi lan mot dong -> quan sat that: 5 dong "VOTAM-PC" offline trung
          // nhau lam nhieu ca danh sach. Job retention se xoa han chung sau 7 ngay;
          // day chi la lop an o UI de danh sach sach ngay lap tuc.
          or(
            isNotNull(deviceIdentity.mac),
            isNotNull(deviceIdentity.nodeKey)
          )
        )
      )
    const home = await db
      .select({ mac: clientHomeDerp.mac, reportedAt: clientHomeDerp.reportedAt })
      .from(clientHomeDerp)
    const homeMap = new Map(home.map((h) => [h.mac, h.reportedAt]))
    const now = Date.now()
    const hsOnline = await headscaleOnlineByNodeKey(now).catch((e) => {
      app.log.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'devices/live: headscale online lookup failed; falling back to telemetry only'
      )
      return null
    })
    return devs.map((d) => {
      // Tín hiệu telemetry "thấy gần nhất": home-derp (báo ~3s/lần khi online).
      // KHÔNG fallback updatedAt cho việc tính `reporting` — updatedAt là lần
      // device-register (1 lần/khởi động daemon), nó không chứng minh telemetry
      // đang chạy; dùng nó sẽ che đúng cái lỗi ta vừa sửa.
      const homeSeen = d.mac ? homeMap.get(d.mac) : undefined
      const telemetrySeenMs = homeSeen ? new Date(homeSeen).getTime() : null
      const key = normalizeNodeKey(d.nodeKey)
      const headscaleOnline = hsOnline ? (hsOnline.get(key ?? '') ?? false) : null
      const { online, reporting } = resolveDeviceLiveState({
        telemetrySeenMs,
        headscaleOnline,
        nowMs: now,
      })
      // "Last seen" vẫn lấy tín hiệu mới nhất từng thấy (telemetry hoặc lần
      // register gần nhất) để cột này không trống với máy chưa từng báo.
      const seen = homeSeen ?? d.updatedAt
      return {
        id: d.id,
        mac: d.mac,
        nodeKey: d.nodeKey,
        name: d.hostname,
        ip: d.staticIpv4 || d.lastIpv4,
        staticIp: d.staticIpv4,
        version: d.clientVersion,
        build: d.clientBuild,
        variant: d.clientVariant,
        // 'client' | 'derp_infra' — UI dung de gan nhan/loc; node ha tang van
        // hien o day vi chung cung chay client mod (co version + telemetry).
        deviceType: d.deviceType,
        lastSeen: seen ? new Date(seen).toISOString() : null,
        online,
        reporting,
      }
    })
  })

  // Backfill 1 lần — kích hoạt tay từ CMS, KHÔNG chạy tự động lúc migrate/boot
  // (tránh phụ thuộc headscale API trong đường khởi động server).
  app.post('/api/devices/backfill', async (_req, reply) => {
    try {
      const result = await backfillDeviceRegistry()
      return result
    } catch (e) {
      return reply.code(502).send({ error: String(e) })
    }
  })
}
