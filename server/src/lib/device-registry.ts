/**
 * "Device registry" hợp nhất (bảng device_identity) — mọi thiết bị (client
 * thật lẫn hạ tầng DERP) có 1 dòng, phân biệt bởi deviceType. Thay thế cách
 * đoán "đây là DERP hay client" qua tên/hostname (derpNameSet/isDerpNode ở
 * frontend, xem lịch sử bug PR #16/#17) bằng dữ liệu tường minh, luôn đồng bộ
 * ở mọi điểm thêm/xóa thiết bị:
 *  - client mới → upsertClientDevice() (gọi từ routes/device-identity.ts)
 *  - DERP region tạo/sửa/xóa → upsertDerpInfraDevice()/deleteDerpInfraDevice()
 *    (gọi từ routes/derp.ts)
 *  - xóa machine ở Machines UI → deleteDeviceByNodeKey() (gộp vào
 *    node-cascade-delete.ts)
 */

import { randomBytes } from 'node:crypto'
import { eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  clientVersionHistory,
  deviceIdentity,
  derpServers,
} from '../db/schema.js'
import { hsApi } from './headscale.js'

function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Hướng đổi build: lần đầu có build / tăng (nâng cấp) / giảm (hạ cấp). Thuần
 *  để unit-test được. */
export function versionChangeDirection(
  prevBuild: number | null,
  newBuild: number
): 'initial' | 'upgrade' | 'downgrade' {
  if (prevBuild == null) return 'initial'
  return newBuild > prevBuild ? 'upgrade' : 'downgrade'
}

/**
 * Chuẩn hóa nodeKey về đúng 1 định dạng (`nodekey:<hex>`) trước khi lưu/so
 * sánh — headscale's API trả về CÓ tiền tố, nhưng admin gõ tay vào form DERP
 * (ts_node_key) có thể chỉ dán phần hex, KHÔNG có tiền tố. Nếu không chuẩn
 * hóa, so sánh chuỗi sẽ coi 2 giá trị này là 2 nodeKey khác nhau -> tạo trùng
 * dòng device_identity cho cùng 1 node (đã xảy ra thật, xem lịch sử sự cố).
 */
export function normalizeNodeKey(key: string | null | undefined): string | null {
  if (!key) return null
  const trimmed = key.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.startsWith('nodekey:') ? trimmed : `nodekey:${trimmed}`
}

/**
 * Upsert 1 client thật — dùng bởi POST /api/internal/device-register.
 *
 * Bảng device_identity có 2 khóa UNIQUE độc lập: `mac` VÀ `node_key`. Bản cũ
 * chỉ tra theo `mac` rồi INSERT thẳng — nếu `node_key` đã tồn tại ở 1 DÒNG
 * KHÁC (rất hay gặp: dòng do backfillDeviceRegistry() tạo với mac=null từ
 * headscale, hoặc client đổi primaryMAC giữa các lần khởi động) thì INSERT vi
 * phạm `device_identity_node_key_unique` → route trả 502 (đúng lỗi đã thấy).
 * Nhánh UPDATE cũ (`nodeKey ?? existing.nodeKey`) cũng vi phạm tương tự nếu
 * node báo lại 1 node_key đang thuộc dòng khác. Vì vậy reconcile theo CẢ hai
 * khóa, trong 1 transaction (postgres-js hỗ trợ) để tránh cả race select→insert.
 */
/**
 * Quyết định thao tác DB thuần (không I/O) từ 2 dòng tra được theo `mac` và
 * theo `node_key`. Tách riêng để unit-test được nhánh dễ sai này — nguyên nhân
 * gốc của lỗi 502 duplicate node_key. Quy ước: `node_key` là danh tính mạnh
 * hơn (tailscale identity), nên khi node_key đã có dòng thì neo mac vào đó.
 */
export type ClientDeviceAction =
  | { kind: 'insert' }
  | { kind: 'update-by-mac'; id: number }
  | { kind: 'adopt-node-key'; keyRowId: number; clearMacFromId: number | null }

export function resolveClientDeviceAction(
  byMac: { id: number } | undefined,
  byKey: { id: number } | undefined
): ClientDeviceAction {
  // node_key đã tồn tại ở 1 dòng KHÁC dòng-theo-mac (dòng backfill mac=null,
  // hoặc client đổi primaryMAC): gán mac vào ĐÚNG dòng node_key đó thay vì
  // INSERT dòng mới (sẽ vi phạm node_key_unique — chính là lỗi 502 đã thấy).
  if (byKey && (!byMac || byMac.id !== byKey.id)) {
    return {
      kind: 'adopt-node-key',
      keyRowId: byKey.id,
      // mac đang thuộc 1 dòng khác → phải gỡ mac khỏi dòng cũ trước, nếu không
      // sẽ vi phạm mac_unique khi gán sang dòng node_key.
      clearMacFromId: byMac && byMac.id !== byKey.id ? byMac.id : null,
    }
  }
  if (!byMac) return { kind: 'insert' }
  // Có dòng theo mac (và nếu có dòng theo node_key thì cùng dòng) → node_key
  // mới (nếu có) chắc chắn chưa thuộc dòng khác nên update không đụng unique.
  return { kind: 'update-by-mac', id: byMac.id }
}

/** Thông tin đổi build (trả về để route ghi log file server theo dõi). */
export type VersionChangeInfo = {
  hostname: string
  fromBuild: number | null
  toBuild: number
  direction: 'initial' | 'upgrade' | 'downgrade'
}

export async function upsertClientDevice(opts: {
  mac: string
  hostname: string
  nodeKey: string | null
  ipv4?: string | null
  clientVersion?: string | null
  clientBuild?: number | null
  clientVariant?: string | null
}): Promise<VersionChangeInfo | null> {
  const { mac, hostname, ipv4, clientVersion, clientBuild, clientVariant } = opts
  const nodeKey = normalizeNodeKey(opts.nodeKey)

  // Đổi build (nếu có) — trả ra ngoài để route log; gán trong transaction.
  let versionChange: VersionChangeInfo | null = null

  // 1 transaction (postgres-js hỗ trợ) bao select→ghi để tránh race register.
  await db.transaction(async (tx) => {
    const [byMac] = await tx
      .select()
      .from(deviceIdentity)
      .where(eq(deviceIdentity.mac, mac))
    const [byKey] = nodeKey
      ? await tx
          .select()
          .from(deviceIdentity)
          .where(eq(deviceIdentity.nodeKey, nodeKey))
      : []

    const action = resolveClientDeviceAction(byMac, byKey)

    if (action.kind === 'insert') {
      await tx.insert(deviceIdentity).values({
        mac,
        hostname,
        nodeKey,
        deviceType: 'client',
        deviceToken: generateToken(),
        lastIpv4: ipv4 ?? null,
        clientVersion: clientVersion ?? null,
        clientBuild: clientBuild ?? null,
        clientVariant: clientVariant ?? null,
        updatedAt: new Date(),
      })
      if (clientBuild != null) {
        versionChange = {
          hostname,
          fromBuild: null,
          toBuild: clientBuild,
          direction: 'initial',
        }
        await tx.insert(clientVersionHistory).values({
          mac,
          hostname,
          fromBuild: null,
          toBuild: clientBuild,
          fromVersion: null,
          toVersion: clientVersion ?? null,
          direction: 'initial',
          changedAt: new Date(),
        })
      }
      return
    }

    if (action.kind === 'update-by-mac') {
      await tx
        .update(deviceIdentity)
        .set({
          nodeKey: nodeKey ?? byMac.nodeKey,
          lastIpv4: ipv4 ?? byMac.lastIpv4,
          clientVersion: clientVersion ?? byMac.clientVersion,
          clientBuild: clientBuild ?? byMac.clientBuild,
          clientVariant: clientVariant ?? byMac.clientVariant,
          updatedAt: new Date(),
        })
        .where(eq(deviceIdentity.id, action.id))
      if (clientBuild != null && clientBuild !== byMac.clientBuild) {
        versionChange = {
          hostname: byMac.hostname,
          fromBuild: byMac.clientBuild ?? null,
          toBuild: clientBuild,
          direction: versionChangeDirection(byMac.clientBuild ?? null, clientBuild),
        }
        await tx.insert(clientVersionHistory).values({
          mac,
          hostname: byMac.hostname,
          fromBuild: byMac.clientBuild ?? null,
          toBuild: clientBuild,
          fromVersion: byMac.clientVersion ?? null,
          toVersion: clientVersion ?? null,
          direction: versionChangeDirection(byMac.clientBuild ?? null, clientBuild),
          changedAt: new Date(),
        })
      }
      return
    }

    // adopt-node-key: giữ hostname chuẩn cũ trên dòng node_key, neo mac vào đó.
    if (action.clearMacFromId !== null) {
      await tx
        .update(deviceIdentity)
        .set({ mac: null, updatedAt: new Date() })
        .where(eq(deviceIdentity.id, action.clearMacFromId))
    }
    await tx
      .update(deviceIdentity)
      .set({
        mac,
        lastIpv4: ipv4 ?? byKey?.lastIpv4 ?? null,
        clientVersion: clientVersion ?? byKey?.clientVersion ?? null,
        clientBuild: clientBuild ?? byKey?.clientBuild ?? null,
        clientVariant: clientVariant ?? byKey?.clientVariant ?? null,
        updatedAt: new Date(),
      })
      .where(eq(deviceIdentity.id, action.keyRowId))
    const prevBuild = byKey?.clientBuild ?? null
    if (clientBuild != null && clientBuild !== prevBuild) {
      versionChange = {
        hostname: byKey?.hostname ?? hostname,
        fromBuild: prevBuild,
        toBuild: clientBuild,
        direction: versionChangeDirection(prevBuild, clientBuild),
      }
      await tx.insert(clientVersionHistory).values({
        mac,
        hostname: byKey?.hostname ?? hostname,
        fromBuild: prevBuild,
        toBuild: clientBuild,
        fromVersion: byKey?.clientVersion ?? null,
        toVersion: clientVersion ?? null,
        direction: versionChangeDirection(prevBuild, clientBuild),
        changedAt: new Date(),
      })
    }
  })

  return versionChange
}

/** Upsert theo nodeKey — dùng bởi routes/derp.ts khi admin gán ts_node_key cho 1 region. */
export async function upsertDerpInfraDevice(opts: {
  nodeKey: string
  hostname: string
}): Promise<void> {
  const nodeKey = normalizeNodeKey(opts.nodeKey)
  if (!nodeKey) return
  await db
    .insert(deviceIdentity)
    .values({
      mac: null,
      hostname: opts.hostname,
      nodeKey,
      deviceType: 'derp_infra',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: deviceIdentity.nodeKey,
      set: { hostname: opts.hostname, deviceType: 'derp_infra', updatedAt: new Date() },
    })
}

export async function deleteDeviceByNodeKey(nodeKey: string): Promise<void> {
  const normalized = normalizeNodeKey(nodeKey)
  if (!normalized) return
  await db.delete(deviceIdentity).where(eq(deviceIdentity.nodeKey, normalized))
}

export async function deleteDeviceByMac(mac: string): Promise<void> {
  await db.delete(deviceIdentity).where(eq(deviceIdentity.mac, mac))
}

type HsNode = {
  nodeKey?: string
  givenName?: string
  name?: string
  user?: { name?: string; displayName?: string; email?: string } | string
}

function userLabel(u: HsNode['user']): string | null {
  if (!u) return null
  if (typeof u === 'string') return u || null
  return u.name || u.displayName || u.email || null
}

/**
 * Backfill 1 lần (kích hoạt tay qua POST /api/devices/backfill, KHÔNG chạy tự
 * động lúc boot — tránh phụ thuộc gọi headscale API trong đường migrate/khởi
 * động server). Với mỗi derp_servers CHƯA có ts_node_key: thử match bằng
 * chính cách đoán cũ (node_name hoặc hostname-prefix) để điền ts_node_key +
 * tạo dòng derp_infra. Machine nào còn lại (không khớp derp_servers, chưa có
 * trong device_identity) → insert client, mac=null, managed_user lấy từ user
 * headscale sẵn có.
 */
export async function backfillDeviceRegistry(): Promise<{
  derpMatched: number
  derpUnmatched: string[]
  clientsBackfilled: number
}> {
  const { nodes } = await hsApi<{ nodes?: HsNode[] }>('/api/v1/node')
  const allNodes = nodes ?? []

  const derpRows = await db
    .select()
    .from(derpServers)
    .where(isNull(derpServers.tsNodeKey))

  let derpMatched = 0
  const derpUnmatched: string[] = []
  for (const region of derpRows) {
    const candidates = [
      region.nodeName?.toLowerCase().trim(),
      region.hostname.split('.')[0]?.toLowerCase().trim(),
    ].filter(Boolean)
    const match = allNodes.find((n) => {
      const name = (n.givenName || n.name || '').toLowerCase().trim()
      return name && candidates.includes(name)
    })
    if (match?.nodeKey) {
      await db
        .update(derpServers)
        .set({ tsNodeKey: match.nodeKey, updatedAt: new Date() })
        .where(eq(derpServers.regionId, region.regionId))
      await upsertDerpInfraDevice({
        nodeKey: match.nodeKey,
        hostname: match.givenName || match.name || region.hostname,
      })
      derpMatched++
    } else {
      derpUnmatched.push(region.code)
    }
  }

  const allKnown = new Set(
    (
      await db.select({ nodeKey: deviceIdentity.nodeKey }).from(deviceIdentity)
    )
      .map((r) => normalizeNodeKey(r.nodeKey))
      .filter((k): k is string => !!k)
  )

  let clientsBackfilled = 0
  const leftover = allNodes.filter((n) => {
    const normalized = normalizeNodeKey(n.nodeKey)
    return normalized && !allKnown.has(normalized)
  })
  for (const n of leftover) {
    const nodeKey = normalizeNodeKey(n.nodeKey)
    if (!nodeKey) continue
    await db
      .insert(deviceIdentity)
      .values({
        mac: null,
        hostname: n.givenName || n.name || 'unknown',
        nodeKey,
        managedUser: userLabel(n.user),
        deviceType: 'client',
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: deviceIdentity.nodeKey })
    clientsBackfilled++
  }

  return { derpMatched, derpUnmatched, clientsBackfilled }
}

/** Chuẩn hoá hostname để so khớp "cùng máy": bỏ hậu tố dedup "-N" headscale
 *  thêm khi tên trùng, hạ chữ thường, trim. Thuần — unit-test. */
export function normalizeHostForMatch(h: string | null | undefined): string {
  return (h ?? '')
    .toLowerCase()
    .trim()
    .replace(/-\d+$/, '')
}

/** Từ danh sách node headscale, trả id các node ĐANG GIỮ targetIp và thuộc
 *  CÙNG máy (hostname khớp) VÀ đang OFFLINE — node cũ còn sót từ lần đăng ký
 *  trước, cần thu hồi để giải phóng IP cho node mới nhận đúng IP DB đã gán.
 *  Hai lớp an toàn: (1) chỉ khớp cùng-hostname → không đụng máy khác; (2) chỉ
 *  xoá node OFFLINE (online === false) → không bao giờ ngắt 1 node đang chạy,
 *  kể cả trùng tên. Node có online=undefined (không rõ) cũng KHÔNG xoá.
 *  Thuần — unit-test. */
export function staleNodesHoldingIp(
  targetIp: string,
  hostname: string,
  nodes: Array<{
    id?: string | null
    name?: string | null
    givenName?: string | null
    ipAddresses?: string[] | null
    online?: boolean | null
  }>
): string[] {
  const host = normalizeHostForMatch(hostname)
  if (!targetIp || !host) return []
  const out: string[] = []
  for (const n of nodes) {
    if (!n.id) continue
    if (n.online !== false) continue // chỉ thu hồi node offline (an toàn)
    if (!(n.ipAddresses ?? []).includes(targetIp)) continue
    if (normalizeHostForMatch(n.givenName || n.name) === host) out.push(n.id)
  }
  return out
}

/**
 * IP trả cho GET /api/internal/reserved-ip.
 * - pin=true (headscale reconcile tất định, plan IP-pin consistency): CHỈ static_ipv4
 *   (admin ghim); null nếu chưa ghim → headscale đi nhánh CHEAP, KHÔNG chase last_ipv4
 *   đang trôi (B2).
 * - pin=false (luồng cũ, tương thích ngược): static_ipv4 || last_ipv4 || null.
 * Thuần — unit-test.
 */
export function pickReservedIp(
  row: { staticIpv4?: string | null; lastIpv4?: string | null } | undefined,
  pin: boolean
): string | null {
  if (pin) return row?.staticIpv4 || null
  return row?.staticIpv4 || row?.lastIpv4 || null
}

/** Hostname là của máy runner CI (GitHub Actions) tự chạy trong smoke-test,
 *  KHÔNG phải máy người dùng thật — dùng để device-register bỏ qua, tránh mỗi
 *  lần build lại tạo 1 dòng device_identity rác (vd "runnervmuktm0"). Bắt các
 *  mẫu runner GitHub-hosted: "runnervm…" (Windows) và "fv-az…" (Azure/Linux).
 *  Thuần — unit-test. */
export function isCiRunnerHostname(h: string | null | undefined): boolean {
  const s = (h ?? '').toLowerCase().trim()
  if (!s) return false
  return /^runnervm[a-z0-9-]*$/.test(s) || /^fv-az[a-z0-9-]*$/.test(s)
}

/** Máy ONLINE nếu có tín hiệu telemetry (home-derp/last report) trong
 *  `windowMs` gần đây. Thuần — unit-test. lastSeenMs=null (chưa từng báo) →
 *  offline. */
export function isDeviceOnline(
  lastSeenMs: number | null,
  nowMs: number,
  windowMs = 60_000
): boolean {
  if (lastSeenMs == null) return false
  return nowMs - lastSeenMs < windowMs
}

/**
 * Trạng thái sống của 1 máy, hợp nhất HAI tín hiệu ĐỘC LẬP:
 *
 *  - `headscaleOnline`: headscale còn giữ map-poll mở với node. Đây là bằng
 *    chứng MẠNH NHẤT rằng máy đang chạy và nối được control plane.
 *  - `telemetrySeenMs`: lần cuối client tự báo telemetry (home-derp ~3s/lần).
 *
 * Vì sao phải OR chứ không chỉ dùng telemetry: telemetry có thể chết RIÊNG
 * trong khi máy vẫn online (đã gặp thật — reporter chốt MAC rỗng lúc khởi động
 * nên mọi POST bị 400, xem homederpreport.go). Khi đó máy vẫn ONLINE, chỉ là
 * KHÔNG BÁO CÁO (`reporting=false`) — hai chuyện khác nhau, UI phải phân biệt
 * được thay vì hiển thị "Offline" sai.
 *
 * Ngược lại, telemetry tươi mà headscale nói offline (hoặc chưa cấu hình
 * headscale) vẫn tính là online — client đang nói chuyện được với dashboard.
 *
 * `headscaleOnline=null` = không biết (headscale chưa cấu hình / gọi lỗi) →
 * chỉ dựa vào telemetry, đúng hành vi cũ, không hồi quy.
 *
 * Thuần — unit-test.
 */
export function resolveDeviceLiveState(opts: {
  telemetrySeenMs: number | null
  headscaleOnline: boolean | null
  nowMs: number
  windowMs?: number
}): { online: boolean; reporting: boolean } {
  const { telemetrySeenMs, headscaleOnline, nowMs, windowMs = 60_000 } = opts
  const reporting = isDeviceOnline(telemetrySeenMs, nowMs, windowMs)
  return { online: reporting || headscaleOnline === true, reporting }
}
