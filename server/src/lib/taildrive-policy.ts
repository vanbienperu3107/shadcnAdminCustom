/**
 * Sinh + đẩy phần "nodeAttrs" + "grants" của headscale ACL policy cho tính
 * năng chia sẻ thư mục (Taildrive) — thay cho cách tiếp cận cũ (headscale tự
 * gọi ngược dashboard qua /api/internal/taildrive/:nodeKey). Bản headscale
 * đang chạy (feat/pernode-derpmap) đã hỗ trợ nodeAttrs+grants CHUẨN Tailscale
 * ngay trong policy engine (hscontrol/policy/v2), nên không cần module patch
 * tự chế nữa — chỉ cần POLICY_MODE=database và gọi thẳng PUT /api/v1/policy
 * có sẵn của headscale.
 *
 * QUAN TRỌNG: 2 khóa "nodeAttrs" và "grants" trong policy document coi như
 * DO TÍNH NĂNG NÀY SỞ HỮU HOÀN TOÀN — mỗi lần push sẽ THAY THẾ TOÀN BỘ 2
 * mảng này (tính lại từ đầu dựa trên folder_shares/folder_share_access hiện
 * tại), không merge từng phần tử. Các khóa khác (acls/groups/hosts/
 * tagOwners/autoApprovers/ssh) được giữ nguyên. Nếu admin cần tự thêm
 * nodeAttrs/grants thủ công cho mục đích khác, cần một cơ chế khác (không hỗ
 * trợ ở đây) — tránh trộn 2 nguồn ghi vào cùng 1 khóa.
 */

import { desc, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deviceIdentity,
  folderShareAccess,
  folderShares,
  latencySamples,
} from '../db/schema.js'
import { hsApi } from './headscale.js'

type NodeAttrGrant = { target: string[]; attr: string[] }
type Grant = { src: string[]; dst: string[]; app: Record<string, unknown[]> }

/** IP tailnet (static ưu tiên, fallback last-seen) dạng CIDR /32; null nếu chưa biết. */
function toHostCidr(ip: string | null): string | null {
  return ip ? `${ip}/32` : null
}

/** Tính nodeAttrs + grants từ toàn bộ folder_shares/folder_share_access đang
 *  enabled. Thuần — không chạm DB, dễ unit-test. macIp: MAC -> IP tailnet
 *  (đã resolve sẵn từ device_identity). */
export function buildTaildriveGrants(
  shares: Array<{ id: number; ownerMac: string; shareName: string; enabled: boolean }>,
  access: Array<{ shareId: number; granteeMac: string; access: string; enabled: boolean }>,
  macIp: Map<string, string | null>
): { nodeAttrs: NodeAttrGrant[]; grants: Grant[] } {
  const enabledShares = new Map(shares.filter((s) => s.enabled).map((s) => [s.id, s]))

  const shareOwnerMacs = new Set<string>()
  const accessGranteeMacs = new Set<string>()
  const driveGrants: Grant[] = []
  const sharerPairs = new Map<string, Grant>() // key: "ownerMac|granteeMac" -> grant (dedup)

  for (const a of access) {
    if (!a.enabled) continue
    const share = enabledShares.get(a.shareId)
    if (!share) continue

    const ownerIp = toHostCidr(macIp.get(share.ownerMac) ?? null)
    const granteeIp = toHostCidr(macIp.get(a.granteeMac) ?? null)
    if (!ownerIp || !granteeIp) continue // chưa biết IP tailnet — bỏ qua, sẽ tự thêm khi có

    shareOwnerMacs.add(share.ownerMac)
    accessGranteeMacs.add(a.granteeMac)

    driveGrants.push({
      src: [granteeIp],
      dst: [ownerIp],
      app: {
        'tailscale.com/cap/drive': [
          { shares: [share.shareName], access: a.access === 'ro' ? 'ro' : 'rw' },
        ],
      },
    })

    const pairKey = `${share.ownerMac}|${a.granteeMac}`
    if (!sharerPairs.has(pairKey)) {
      sharerPairs.set(pairKey, {
        src: [ownerIp],
        dst: [granteeIp],
        app: { 'tailscale.com/cap/drive-sharer': [{}] },
      })
    }
  }

  const nodeAttrs: NodeAttrGrant[] = []
  const ownerTargets = [...shareOwnerMacs].map((m) => toHostCidr(macIp.get(m) ?? null)).filter((x): x is string => !!x)
  const granteeTargets = [...accessGranteeMacs].map((m) => toHostCidr(macIp.get(m) ?? null)).filter((x): x is string => !!x)
  if (ownerTargets.length > 0) nodeAttrs.push({ target: ownerTargets, attr: ['drive:share'] })
  if (granteeTargets.length > 0) nodeAttrs.push({ target: granteeTargets, attr: ['drive:access'] })

  return { nodeAttrs, grants: [...driveGrants, ...sharerPairs.values()] }
}

/** Đọc toàn bộ folder_shares/folder_share_access (enabled hoặc không — lọc ở
 *  buildTaildriveGrants) + map MAC->IP, tính nodeAttrs/grants, rồi GET policy
 *  hiện tại, thay 2 khóa đó, PUT lại. Ném lỗi nếu headscale từ chối (vd chưa
 *  bật POLICY_MODE=database) — caller quyết định có chặn request hay chỉ log. */
export async function pushTaildrivePolicy(): Promise<void> {
  const shares = await db
    .select({
      id: folderShares.id,
      ownerMac: folderShares.ownerMac,
      shareName: folderShares.shareName,
      enabled: folderShares.enabled,
    })
    .from(folderShares)
  const access = await db
    .select({
      shareId: folderShareAccess.shareId,
      granteeMac: folderShareAccess.granteeMac,
      access: folderShareAccess.access,
      enabled: folderShareAccess.enabled,
    })
    .from(folderShareAccess)

  const macs = [...new Set([...shares.map((s) => s.ownerMac), ...access.map((a) => a.granteeMac)])]
  const macIp = new Map<string, string | null>()
  if (macs.length > 0) {
    const rows = await db
      .select({ mac: deviceIdentity.mac, staticIp: deviceIdentity.staticIpv4, lastIp: deviceIdentity.lastIpv4 })
      .from(deviceIdentity)
    for (const r of rows) {
      if (r.mac) macIp.set(r.mac, r.staticIp || r.lastIp || null)
    }

    // Fallback cho MAC chưa có device_identity (vd máy chỉ mới report qua
    // /api/metrics/report — CHÍNH LÀ nguồn mà dialog folder-share dùng để
    // liệt kê "máy online" (xem /api/node-runtime/online), nên phải resolve
    // IP từ cùng nguồn đó, nếu không owner/grantee chọn từ dialog có thể bị
    // âm thầm bỏ qua (không có nodeAttrs/grants) mà không báo lỗi gì.
    const missing = macs.filter((m) => !macIp.get(m))
    if (missing.length > 0) {
      const fallbackRows = await db
        .select({ mac: latencySamples.mac, srcIp: latencySamples.srcIp })
        .from(latencySamples)
        .where(inArray(latencySamples.mac, missing))
        .orderBy(desc(latencySamples.reportedAt))
      for (const r of fallbackRows) {
        if (r.mac && r.srcIp && !macIp.get(r.mac)) macIp.set(r.mac, r.srcIp)
      }
    }
  }

  const { nodeAttrs, grants } = buildTaildriveGrants(shares, access, macIp)

  const current = await hsApi<{ policy: string }>('/api/v1/policy')
  let doc: Record<string, unknown>
  try {
    doc = current.policy ? JSON.parse(current.policy) : {}
  } catch {
    // Policy hiện tại không phải JSON thuần (HuJSON có comment) — không an
    // toàn để parse+ghi đè tự động, dừng lại thay vì phá policy admin đang có.
    throw new Error('current headscale policy is not plain JSON (has comments?) — refusing to auto-edit')
  }

  doc.nodeAttrs = nodeAttrs
  doc.grants = grants

  await hsApi('/api/v1/policy', {
    method: 'PUT',
    body: JSON.stringify({ policy: JSON.stringify(doc) }),
  })
}
