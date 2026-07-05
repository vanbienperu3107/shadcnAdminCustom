/**
 * Xóa/đổi tên 1 thiết bị KHÔNG được để lại rác trong các bảng per-node/per-mac
 * đã tích lũy qua nhiều tính năng (Node Runtime, Node Assignments/DERP-lock,
 * reload requests, netcheck ports, latency, folder-share). Gom cascade-delete
 * vào 1 hàm để mọi nơi xóa thiết bị (Machines UI hiện tại, node-dedup sau
 * này) đều gọi đúng chỗ, không sót bảng nào khi thêm bảng per-node mới.
 *
 * Khớp theo 2 khóa vì mỗi bảng dùng khóa khác nhau — không có 1 khóa chung:
 *  - nodeKey (headscale node key) → derp_node_assignments, derp_node_options,
 *    derp_node_health, device_identity (device registry hợp nhất — cả client
 *    lẫn derp_infra đều có node_key, xem lib/device-registry.ts). nodeKey ổn
 *    định trong 1 lần cài, và device_identity.node_key là UNIQUE — nên nó là
 *    cách DUY NHẤT đáng tin để suy ra "đúng 1 MAC" của thiết bị đang xóa.
 *  - hostname (case-insensitive) → CHỈ dùng cho 2 bảng telemetry thuần
 *    (client_netcheck, latency_samples) — xóa nhầm 1 dòng netcheck/latency
 *    của thiết bị khác trùng tên chỉ mất vài giây (tự report lại), vô hại.
 *    KHÔNG dùng hostname để suy ra MAC cho bất kỳ bảng "sở hữu" nào
 *    (node_runtime_config, folder_shares, folder_share_access, folder_browse,
 *    device_identity-by-mac) — device_identity.hostname KHÔNG unique (tự
 *    báo cáo, không đổi sau lần đăng ký đầu), nên 2 máy trùng tên (imaged
 *    hàng loạt là chuyện thường) sẽ khiến việc xóa 1 máy quét trúng MAC của
 *    máy còn lại, xóa mất share/access/runtime-config của người khác.
 */

import { eq, ilike, or } from 'drizzle-orm'
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

  // Resolve the ONE precise MAC for this device — BEFORE deleting
  // device_identity below, since that row is the only place nodeKey and mac
  // are linked (nodeKey rotates every reinstall, mac does not).
  //
  // Primary path: by nodeKey (unique — always safe). The current caller
  // (routes/headscale.ts DELETE /api/machines/:id) always has this, since
  // headscale's own node record is fetched right before deletion.
  //
  // Fallback (nodeKey unavailable — only when that headscale lookup itself
  // failed): by hostname, but ONLY if it identifies a single device_identity
  // row. hostname is not unique, so if two devices share it there is no safe
  // way to pick one — skip the per-mac cleanup in that ambiguous case rather
  // than guess and risk deleting a stranger's data.
  let preciseMac: string | null = null
  if (nodeKey) {
    const [d] = await db
      .select({ mac: deviceIdentity.mac })
      .from(deviceIdentity)
      .where(eq(deviceIdentity.nodeKey, nodeKey))
    preciseMac = d?.mac ?? null
  } else if (hostname) {
    const rows = await db
      .select({ mac: deviceIdentity.mac })
      .from(deviceIdentity)
      .where(ilike(deviceIdentity.hostname, hostname))
    if (rows.length === 1 && rows[0].mac) preciseMac = rows[0].mac
  }

  if (nodeKey) {
    await db.delete(derpNodeAssignments).where(eq(derpNodeAssignments.nodeKey, nodeKey))
    await db.delete(derpNodeOptions).where(eq(derpNodeOptions.nodeKey, nodeKey))
    await db.delete(derpNodeHealth).where(eq(derpNodeHealth.nodeKey, nodeKey))
    await db.delete(deviceIdentity).where(eq(deviceIdentity.nodeKey, nodeKey))
  }

  if (preciseMac) {
    await db.delete(nodeRuntimeConfig).where(eq(nodeRuntimeConfig.mac, preciseMac))
    await db.delete(nodeReloadRequests).where(eq(nodeReloadRequests.mac, preciseMac))
    // Folder-share: xóa share do MAC này sở hữu (CASCADE tự xóa access của
    // share đó), access nơi MAC này là grantee, và phiên browse.
    await db.delete(folderShares).where(eq(folderShares.ownerMac, preciseMac))
    await db.delete(folderShareAccess).where(eq(folderShareAccess.granteeMac, preciseMac))
    await db.delete(folderBrowse).where(eq(folderBrowse.mac, preciseMac))
    await db.delete(deviceIdentity).where(eq(deviceIdentity.mac, preciseMac))
  }

  if (hostname) {
    // Telemetry thuần — xóa nhầm dòng của thiết bị trùng tên khác chỉ mất
    // vài giây (tự report lại ở lần poll kế tiếp), không mất cấu hình/quyền.
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
