/**
 * Xóa/đổi tên 1 thiết bị KHÔNG được để lại rác trong các bảng per-node/per-mac
 * đã tích lũy qua nhiều tính năng (Node Runtime, Node Assignments/DERP-lock,
 * reload requests, netcheck ports, latency). Gom cascade-delete vào 1 hàm để
 * mọi nơi xóa thiết bị (Machines UI hiện tại, node-dedup sau này) đều gọi
 * đúng chỗ, không sót bảng nào khi thêm bảng per-node mới.
 *
 * Khớp theo 2 khóa vì mỗi bảng dùng khóa khác nhau — không có 1 khóa chung:
 *  - nodeKey (headscale node key)  → derp_node_assignments, derp_node_options,
 *    derp_node_health, device_identity (device registry hợp nhất — cả client
 *    lẫn derp_infra đều có node_key, xem lib/device-registry.ts).
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
  deviceIdentity,
  folderBrowse,
  folderShareAccess,
  folderShares,
  latencySamples,
  nodeReloadRequests,
  nodeRuntimeConfig,
} from '../db/schema.js'

export async function cascadeDeleteNodeData(opts: {
  nodeKey?: string | null
  hostname?: string | null
}): Promise<void> {
  const { nodeKey, hostname } = opts

  // Resolve every MAC this device might be known by BEFORE deleting
  // device_identity below — device_identity is the only table that carries
  // BOTH nodeKey and mac together (nodeKey rotates every reinstall, mac does
  // not), so once its row is gone this is the last chance to recover the mac
  // from a nodeKey-only caller. Also matched by hostname so a device that
  // only ever surfaced via latency_samples (the source table behind the
  // "online devices" folder-share picker) — and so never wrote a
  // client_netcheck/node_runtime_config row — still gets its per-mac data
  // (folder_shares/folder_share_access/folder_browse included) cleaned up
  // instead of silently orphaned, which would otherwise let a re-provisioned
  // device with the same (stable) MAC inherit a stranger's old share/access
  // grants.
  const macsFromIdentity: string[] = []
  if (nodeKey) {
    const [d] = await db
      .select({ mac: deviceIdentity.mac })
      .from(deviceIdentity)
      .where(eq(deviceIdentity.nodeKey, nodeKey))
    if (d?.mac) macsFromIdentity.push(d.mac)
  }
  if (hostname) {
    const rows = await db
      .select({ mac: deviceIdentity.mac })
      .from(deviceIdentity)
      .where(ilike(deviceIdentity.hostname, hostname))
    for (const r of rows) if (r.mac) macsFromIdentity.push(r.mac)
  }

  // MAC từng report dưới hostname này (client_netcheck.client,
  // node_runtime_config.hostname, latency_samples.mac — nguồn của picker
  // "thiết bị online") để xóa cascade cả node_runtime_config (khóa chính =
  // mac, không phải hostname) và node_reload_requests. Chạy trước khối
  // `if (nodeKey)` xóa device_identity vì không phụ thuộc thứ tự, và union
  // với macsFromIdentity NGOÀI mọi nhánh if/hostname để nhánh chỉ có nodeKey
  // (không có hostname) vẫn dọn được per-mac data.
  const macsFromNetcheck = hostname
    ? await db
        .select({ client: clientNetcheck.client })
        .from(clientNetcheck)
        .where(ilike(clientNetcheck.client, hostname))
    : []
  const macsFromRuntime = hostname
    ? await db
        .select({ mac: nodeRuntimeConfig.mac })
        .from(nodeRuntimeConfig)
        .where(ilike(nodeRuntimeConfig.hostname, hostname))
    : []
  const macsFromLatency = hostname
    ? await db
        .select({ mac: latencySamples.mac })
        .from(latencySamples)
        .where(ilike(latencySamples.srcHostname, hostname))
    : []

  const macs = Array.from(
    new Set([
      ...macsFromIdentity,
      ...macsFromNetcheck.map((r) => r.client),
      ...macsFromRuntime.map((r) => r.mac),
      ...macsFromLatency.map((r) => r.mac).filter((m): m is string => !!m),
    ])
  )

  if (nodeKey) {
    await db.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, nodeKey))
    await db.delete(derpNodeOptions).where(eq(derpNodeOptions.nodeKey, nodeKey))
    await db.delete(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, nodeKey))
    await db.delete(deviceIdentity).where(eq(deviceIdentity.nodeKey, nodeKey))
  }

  if (macs.length > 0) {
    await db.delete(nodeRuntimeConfig).where(inArray(nodeRuntimeConfig.mac, macs))
    await db.delete(nodeReloadRequests).where(inArray(nodeReloadRequests.mac, macs))
    // Folder-share: xóa share do các MAC này sở hữu (CASCADE tự xóa access
    // của share đó), access nơi các MAC này là grantee, và phiên browse.
    await db.delete(folderShares).where(inArray(folderShares.ownerMac, macs))
    await db.delete(folderShareAccess).where(inArray(folderShareAccess.granteeMac, macs))
    await db.delete(folderBrowse).where(inArray(folderBrowse.mac, macs))
    await db.delete(deviceIdentity).where(inArray(deviceIdentity.mac, macs))
  }

  if (hostname) {
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
