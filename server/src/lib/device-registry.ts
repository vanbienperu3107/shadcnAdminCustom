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

export async function upsertClientDevice(opts: {
  mac: string
  hostname: string
  nodeKey: string | null
  ipv4?: string | null
  clientVersion?: string | null
  clientBuild?: number | null
}): Promise<void> {
  const { mac, hostname, ipv4, clientVersion, clientBuild } = opts
  const nodeKey = normalizeNodeKey(opts.nodeKey)

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
        updatedAt: new Date(),
      })
      if (clientBuild != null) {
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
          updatedAt: new Date(),
        })
        .where(eq(deviceIdentity.id, action.id))
      if (clientBuild != null && clientBuild !== byMac.clientBuild) {
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
        updatedAt: new Date(),
      })
      .where(eq(deviceIdentity.id, action.keyRowId))
    const prevBuild = byKey?.clientBuild ?? null
    if (clientBuild != null && clientBuild !== prevBuild) {
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
