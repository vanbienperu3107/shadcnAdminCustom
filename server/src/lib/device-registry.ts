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
import { deviceIdentity, derpServers } from '../db/schema.js'
import { hsApi } from './headscale.js'

function generateToken(): string {
  return randomBytes(24).toString('base64url')
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

/** Upsert theo mac — dùng bởi POST /api/internal/device-register (client thật). */
export async function upsertClientDevice(opts: {
  mac: string
  hostname: string
  nodeKey: string | null
  ipv4?: string | null
}): Promise<void> {
  const { mac, hostname, ipv4 } = opts
  const nodeKey = normalizeNodeKey(opts.nodeKey)
  const [existing] = await db
    .select()
    .from(deviceIdentity)
    .where(eq(deviceIdentity.mac, mac))

  if (!existing) {
    await db.insert(deviceIdentity).values({
      mac,
      hostname,
      nodeKey,
      deviceType: 'client',
      deviceToken: generateToken(),
      lastIpv4: ipv4 ?? null,
      updatedAt: new Date(),
    })
    return
  }

  await db
    .update(deviceIdentity)
    .set({
      nodeKey: nodeKey ?? existing.nodeKey,
      lastIpv4: ipv4 ?? existing.lastIpv4,
      updatedAt: new Date(),
    })
    .where(eq(deviceIdentity.mac, mac))
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
