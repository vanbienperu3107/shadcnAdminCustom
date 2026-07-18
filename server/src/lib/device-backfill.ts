import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { device, deviceEnrollment, deviceMac } from '../db/schema.js'
import { hmacSalt, saltIdentityEnabled } from './device-hmac.js'
import { normalizeMac } from './enrollment.js'

/**
 * Backfill device_enrollment → device + device_mac (plan device_id, F1a nền).
 *
 * Hợp nhất mọi dòng device_enrollment CÙNG salt thành 1 `device` — CHÍNH LÀ fix
 * token_mismatch: một máy vật lý (cùng serial ổ cứng) đổi card mạng sinh nhiều
 * dòng (mac,salt), giờ về đúng 1 định danh. Mỗi MAC → 1 dòng device_mac (alias).
 *
 * Thuần bổ sung + idempotent (ON CONFLICT DO NOTHING) + KHÔNG throw: gọi
 * best-effort sau migrate(). Bỏ qua nếu PEPPER chưa cấu hình (salt_hmac cần nó).
 * `device_identity` KHÔNG có cột salt nên KHÔNG phải nguồn — chỉ device_enrollment.
 */

/** Một dòng device_enrollment cần cho backfill. */
export type EnrollRow = {
  mac: string | null
  salt: string | null
  status: string
  hostname: string | null
  pinnedIpv4: string | null
  note: string | null
}

/** Kế hoạch tạo 1 device (thuần — unit-test được, không chạm DB/PEPPER). */
export type DevicePlan = {
  salt: string
  status: 'approved' | 'pending'
  hostname: string | null
  note: string | null
  staticIpv4: string | null
  macs: string[] // đã normalizeMac
}

/**
 * Gom device_enrollment theo salt. status='approved' nếu CÓ dòng approved VÀ
 * KHÔNG có dòng revoked (admin đã cấm thì giữ cấm). hostname/ip/note lấy dòng
 * đầu tiên có giá trị. Salt rỗng bị bỏ.
 */
export function planBackfill(rows: EnrollRow[]): DevicePlan[] {
  const bySalt = new Map<
    string,
    {
      approved: boolean
      revoked: boolean
      hostname: string | null
      note: string | null
      ip: string | null
      macs: Set<string>
    }
  >()
  for (const r of rows) {
    const salt = r.salt?.trim()
    if (!salt) continue
    let g = bySalt.get(salt)
    if (!g) {
      g = { approved: false, revoked: false, hostname: null, note: null, ip: null, macs: new Set() }
      bySalt.set(salt, g)
    }
    if (r.status === 'approved') g.approved = true
    if (r.status === 'revoked') g.revoked = true
    if (!g.hostname && r.hostname) g.hostname = r.hostname
    if (!g.note && r.note) g.note = r.note
    if (!g.ip && r.pinnedIpv4) g.ip = r.pinnedIpv4
    if (r.mac) {
      const m = normalizeMac(r.mac)
      if (m) g.macs.add(m)
    }
  }
  const out: DevicePlan[] = []
  for (const [salt, g] of bySalt) {
    out.push({
      salt,
      status: g.approved && !g.revoked ? 'approved' : 'pending',
      hostname: g.hostname,
      note: g.note,
      staticIpv4: g.ip,
      macs: [...g.macs],
    })
  }
  return out
}

/** Áp kế hoạch vào DB. Non-throwing per-device để 1 lỗi không chặn cả backfill. */
export async function backfillDevices(
  log: (msg: string) => void = console.log
): Promise<void> {
  if (!saltIdentityEnabled()) {
    log('device backfill: PEPPER chưa cấu hình — bỏ qua (định danh theo salt tạm nghỉ)')
    return
  }

  let rows: EnrollRow[]
  try {
    rows = await db
      .select({
        mac: deviceEnrollment.mac,
        salt: deviceEnrollment.salt,
        status: deviceEnrollment.status,
        hostname: deviceEnrollment.hostname,
        pinnedIpv4: deviceEnrollment.pinnedIpv4,
        note: deviceEnrollment.note,
      })
      .from(deviceEnrollment)
  } catch (e) {
    log(`device backfill: đọc device_enrollment lỗi (${String(e)}) — bỏ qua`)
    return
  }

  const plans = planBackfill(rows)
  let devices = 0
  let macs = 0
  for (const p of plans) {
    const saltHmac = hmacSalt(p.salt)
    if (!saltHmac) continue
    try {
      await db
        .insert(device)
        .values({
          saltHmac,
          status: p.status,
          hostname: p.hostname,
          note: p.note,
          staticIpv4: p.staticIpv4,
        })
        .onConflictDoNothing()
      const [d] = await db
        .select({ id: device.id })
        .from(device)
        .where(eq(device.saltHmac, saltHmac))
      if (!d) continue
      devices++
      const macStatus = p.status === 'approved' ? 'approved' : 'pending'
      for (const mac of p.macs) {
        await db
          .insert(deviceMac)
          .values({
            mac,
            deviceId: d.id,
            status: macStatus,
            approvedAt: p.status === 'approved' ? new Date() : null,
          })
          .onConflictDoNothing()
        macs++
      }
    } catch (e) {
      log(`device backfill: salt group lỗi (${String(e)}) — tiếp tục`)
    }
  }
  log(`device backfill: ${devices} device, ${macs} mac (từ ${plans.length} salt)`)
}
