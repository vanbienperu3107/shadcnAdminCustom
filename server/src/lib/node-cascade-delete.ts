/**
 * Xóa/đổi tên 1 thiết bị KHÔNG được để lại rác trong các bảng per-node/per-mac
 * đã tích lũy qua nhiều tính năng (Node Runtime, Node Assignments/DERP-lock,
 * reload requests, netcheck ports, latency). Gom cascade-delete vào 1 hàm để
 * mọi nơi xóa thiết bị (Machines UI hiện tại, node-dedup sau này) đều gọi
 * đúng chỗ, không sót bảng nào khi thêm bảng per-node mới.
 *
 * Khớp theo 2 khóa vì mỗi bảng dùng khóa khác nhau — không có 1 khóa chung:
 *  - nodeKey (headscale node key)  → derp_node_assignments, derp_node_options,
 *    derp_node_health.
 *  - hostname (case-insensitive)   → client_netcheck.client, node_runtime_config
 *    (hostname côt phụ, khớp CẢ theo mac suy ra từ đó), latency_samples
 *    (src/dst — xóa cả 2 chiều vì node không còn tồn tại để làm src lẫn dst).
 */

import { eq, ilike, inArray, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  clientNetcheck,
  derpNodeAssignments,
  derpNodeHealth,
  derpNodeOptions,
  latencySamples,
  nodeReloadRequests,
  nodeRuntimeConfig,
} from '../db/schema.js'

export async function cascadeDeleteNodeData(opts: {
  nodeKey?: string | null
  hostname?: string | null
}): Promise<void> {
  const { nodeKey, hostname } = opts

  if (nodeKey) {
    await db.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, nodeKey))
    await db.delete(derpNodeOptions).where(eq(derpNodeOptions.nodeKey, nodeKey))
    await db.delete(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, nodeKey))
  }

  if (hostname) {
    // Tìm MAC từng report dưới hostname này (client_netcheck.client và
    // node_runtime_config.hostname) để xóa cascade cả node_runtime_config
    // (khóa chính = mac, không phải hostname) và node_reload_requests.
    const macsFromNetcheck = await db
      .select({ client: clientNetcheck.client })
      .from(clientNetcheck)
      .where(ilike(clientNetcheck.client, hostname))
    const macsFromRuntime = await db
      .select({ mac: nodeRuntimeConfig.mac })
      .from(nodeRuntimeConfig)
      .where(ilike(nodeRuntimeConfig.hostname, hostname))

    const macs = Array.from(
      new Set([
        ...macsFromNetcheck.map((r) => r.client),
        ...macsFromRuntime.map((r) => r.mac),
      ])
    )

    if (macs.length > 0) {
      await db.delete(nodeRuntimeConfig).where(inArray(nodeRuntimeConfig.mac, macs))
      await db.delete(nodeReloadRequests).where(inArray(nodeReloadRequests.mac, macs))
    }
    await db.delete(clientNetcheck).where(ilike(clientNetcheck.client, hostname))
    await db
      .delete(latencySamples)
      .where(
        or(
          ilike(latencySamples.srcHostname, hostname),
          ilike(latencySamples.dstHostname, hostname)
        )
      )
  }
}
