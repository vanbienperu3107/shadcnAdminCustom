/**
 * Tiến trình nền: probe TLS định kỳ cho region đang bị "khóa cứng"
 * (derp_node_options.exclusive=true) của từng node, cập nhật derp_node_health.
 * Tách khỏi request GET /api/internal/derp-map/:nodeKey vì probe TLS có thể
 * mất tới ~8s (2 path x 4s timeout) — quá chậm so với 500ms mà headscale chờ.
 *
 * Van an toàn: region chết liên tục ĐỦ derpNodeHealthFallbackAfterMs (10 phút)
 * → status='fallback' → node-assignments.ts phục vụ map UNION (bình thường)
 * thay vì exclusive, để client không bị kẹt cứng nếu đúng region khóa chết
 * dài hạn. Region sống lại → status='ok' ngay lần probe kế tiếp.
 */

import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { derpNodeAssignments, derpNodeHealth, derpNodeOptions, derpServers } from '../db/schema.js'
import { probeHost } from './probe.js'

export const DERP_NODE_HEALTH_SWEEP_MS = 30_000
export const DERP_NODE_HEALTH_FALLBACK_AFTER_MS = 10 * 60_000 // 10 phút

export async function sweepExclusiveNodeHealth(): Promise<void> {
  const exclusiveNodes = await db
    .select({ nodeKey: derpNodeOptions.nodeKey })
    .from(derpNodeOptions)
    .where(eq(derpNodeOptions.exclusive, true))

  if (exclusiveNodes.length === 0) return

  const nodeKeys = exclusiveNodes.map((n) => n.nodeKey)
  const assignments = await db
    .select({ nodeKey: derpNodeAssignments.nodeKey, regionId: derpNodeAssignments.regionId })
    .from(derpNodeAssignments)
    .where(inArray(derpNodeAssignments.nodeKey, nodeKeys))

  const regionsByNode = new Map<string, number[]>()
  for (const a of assignments) {
    const list = regionsByNode.get(a.nodeKey) ?? []
    list.push(a.regionId)
    regionsByNode.set(a.nodeKey, list)
  }

  const allServers = await db.select().from(derpServers)
  const serverById = new Map(allServers.map((s) => [s.regionId, s]))

  for (const nodeKey of nodeKeys) {
    const regionIds = regionsByNode.get(nodeKey) ?? []
    if (regionIds.length === 0) continue // chưa gán region nào — không có gì để theo dõi

    // "Sống" nếu BẤT KỲ region được gán còn probe được (chỉ cần 1 trong các
    // region khóa còn hoạt động là đủ để không rơi vào fallback).
    let anyUp = false
    for (const regionId of regionIds) {
      const server = serverById.get(regionId)
      if (!server) continue
      const result = await probeHost(server.hostname, server.derpPort)
      if (result.up) {
        anyUp = true
        break
      }
    }

    await upsertHealth(nodeKey, anyUp)
  }
}

async function upsertHealth(nodeKey: string, up: boolean): Promise<void> {
  const [existing] = await db.select().from(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, nodeKey))
  const now = new Date()

  if (up) {
    await db
      .insert(derpNodeHealth)
      .values({ nodeKey, status: 'ok', lastHealthyAt: now, downSince: null, updatedAt: now })
      .onConflictDoUpdate({
        target: derpNodeHealth.nodeKey,
        set: { status: 'ok', lastHealthyAt: now, downSince: null, updatedAt: now },
      })
    return
  }

  const downSince = existing?.downSince ?? now
  const downMs = now.getTime() - downSince.getTime()
  const status = downMs >= DERP_NODE_HEALTH_FALLBACK_AFTER_MS ? 'fallback' : 'grace'

  await db
    .insert(derpNodeHealth)
    .values({ nodeKey, status, lastHealthyAt: existing?.lastHealthyAt ?? null, downSince, updatedAt: now })
    .onConflictDoUpdate({
      target: derpNodeHealth.nodeKey,
      set: { status, downSince, updatedAt: now },
    })
}

/** Bắt đầu vòng probe nền — gọi 1 lần lúc server khởi động. */
export function startDerpNodeHealthSweep(): void {
  void sweepExclusiveNodeHealth().catch(() => {})
  setInterval(() => {
    void sweepExclusiveNodeHealth().catch(() => {})
  }, DERP_NODE_HEALTH_SWEEP_MS)
}
