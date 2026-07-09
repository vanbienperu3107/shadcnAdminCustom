import type { FastifyInstance } from 'fastify'
import { and, count, desc, eq } from 'drizzle-orm'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { deviceEnrollment, deviceIdentity } from '../db/schema.js'
import { env } from '../env.js'
import {
  MAX_PENDING_ROWS,
  enrollDecision,
  hashDeviceToken,
  newDeviceToken,
  normalizeMac,
  normalizeSalt,
  preAuthKeyExpiration,
  type EnrollStatus,
} from '../lib/enrollment.js'
import { hsApi, isHsConfigured } from '../lib/headscale.js'
import { matchHsUserId, type HsUserLite } from '../lib/hs-users.js'

/**
 * Cấp 1 pre-auth key headscale NGẮN HẠN cho lần enroll này.
 *
 * Hai ràng buộc bắt buộc (đã đọc code headscale fork, xem plan §5):
 *  1. `expiration` PHẢI gửi tường minh. Thiếu ⇒ headscale nhận zero-time và
 *     PreAuthKey.Validate() coi là ĐÃ HẾT HẠN ⇒ key chết ngay khi tạo.
 *  2. Key phải thuộc ĐÚNG 1 user cố định (env.HEADSCALE_NODES_USER). Cùng
 *     machinekey nhưng key thuộc user khác ⇒ headscale tạo node MỚI ⇒ trôi IP.
 */
async function mintEnrollmentAuthKey(now: Date): Promise<string> {
  const list = await hsApi<{ users?: HsUserLite[] }>('/api/v1/user')
  const uid = matchHsUserId(list.users ?? [], env.HEADSCALE_NODES_USER)
  if (!uid) {
    throw new Error(`headscale user "${env.HEADSCALE_NODES_USER}" not found`)
  }
  const d = await hsApi<{ preAuthKey?: { key?: string } }>(
    '/api/v1/preauthkey',
    {
      method: 'POST',
      body: JSON.stringify({
        user: uid,
        reusable: true, // client có thể retry `up` trong TTL
        ephemeral: false,
        expiration: preAuthKeyExpiration(now), // BẮT BUỘC — xem (1)
      }),
    }
  )
  const key = d.preAuthKey?.key
  if (!key) throw new Error('headscale returned no pre-auth key')
  return key
}

/** Ghim IP vào device_identity để luồng reserved-ip sẵn có trả đúng IP. */
async function applyPinnedIp(
  mac: string,
  ip: string,
  hostname: string
): Promise<void> {
  await db
    .insert(deviceIdentity)
    .values({ mac, hostname: hostname || mac, staticIpv4: ip })
    .onConflictDoUpdate({
      target: deviceIdentity.mac,
      set: { staticIpv4: ip },
    })
}

/**
 * PUBLIC — client (cmd/tailscaled/nodeenroll.go) gọi khi autologin=true.
 *
 * KHÔNG dùng shared secret: client không bake secret nào. Hàng rào authz là
 * (a) admin phải duyệt dòng, và (b) deviceToken first-enroll-wins sau lần đầu.
 * Chống lạm dụng: rate-limit theo IP, UNIQUE(mac,salt) dedupe, trần pending,
 * và bodyLimit nhỏ.
 */
export async function enrollmentPublicRoutes(
  app: FastifyInstance
): Promise<void> {
  app.post(
    '/api/internal/enroll',
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = req.body as {
        mac?: unknown
        salt?: unknown
        hostname?: unknown
        token?: unknown
        probe?: unknown
      }
      const mac = typeof body.mac === 'string' ? normalizeMac(body.mac) : ''
      // Chuẩn hoá lại phía server: không tin client đã chuẩn hoá đúng.
      const salt = typeof body.salt === 'string' ? normalizeSalt(body.salt) : ''
      const hostname =
        typeof body.hostname === 'string' ? body.hostname.trim() : ''
      const token = typeof body.token === 'string' ? body.token : ''
      // Probe: client CHƯA cấu hình autologin chỉ muốn HỎI "máy này đã được
      // adopt chưa?" — nếu chưa (chưa có dòng) thì trả 404, TUYỆT ĐỐI không tạo
      // dòng pending (tránh rác + tránh kéo mọi máy OIDC bình thường vào enroll).
      const probe =
        body.probe === true ||
        (req.query as { probe?: string } | undefined)?.probe === '1'
      if (!mac || !salt) {
        return reply.code(400).send({ error: 'mac and salt required' })
      }

      const [row] = await db
        .select()
        .from(deviceEnrollment)
        .where(
          and(eq(deviceEnrollment.mac, mac), eq(deviceEnrollment.salt, salt))
        )

      const decision = enrollDecision(
        row
          ? {
              status: row.status as EnrollStatus,
              deviceTokenHash: row.deviceTokenHash,
            }
          : null,
        token
      )

      switch (decision.kind) {
        case 'create-pending': {
          if (probe) {
            // Chưa được adopt/duyệt → báo "không có" để client im lặng quay về
            // luồng đăng nhập OIDC, KHÔNG tạo dòng pending.
            return reply.code(404).send({ status: 'not_enrolled' })
          }
          const [{ value: pendingCount }] = await db
            .select({ value: count() })
            .from(deviceEnrollment)
            .where(eq(deviceEnrollment.status, 'pending'))
          if (pendingCount >= MAX_PENDING_ROWS) {
            req.log.warn({ mac }, 'enroll: pending cap reached, refusing new row')
            return reply.code(429).send({ error: 'too_many_pending' })
          }
          // onConflictDoNothing: hai request song song cùng (mac,salt) chỉ tạo 1 dòng.
          await db
            .insert(deviceEnrollment)
            .values({ mac, salt, hostname: hostname || null, status: 'pending' })
            .onConflictDoNothing()
          req.log.info({ mac, hostname }, 'enroll: new device awaiting approval')
          return reply.code(202).send({ status: 'pending' })
        }

        case 'pending':
          return reply.code(202).send({ status: 'pending' })

        case 'denied':
          req.log.warn(
            { mac, reason: decision.reason },
            'enroll: denied'
          )
          return reply.code(403).send({ reason: decision.reason })

        case 'issue': {
          if (!(await isHsConfigured())) {
            return reply.code(503).send({ error: 'headscale not configured' })
          }
          const now = new Date()
          let authKey: string
          try {
            authKey = await mintEnrollmentAuthKey(now)
          } catch (e) {
            req.log.error({ err: String(e), mac }, 'enroll: mint auth key failed')
            // 502 -> client coi là lỗi tạm và thử lại, không dừng hẳn.
            return reply.code(502).send({ error: String(e) })
          }

          let deviceToken: string | undefined
          const patch: Record<string, unknown> = { lastEnrollAt: now }
          if (decision.mintToken) {
            deviceToken = newDeviceToken()
            patch.deviceTokenHash = hashDeviceToken(deviceToken)
            patch.enrolledAt = now
          }
          await db
            .update(deviceEnrollment)
            .set(patch)
            .where(eq(deviceEnrollment.id, row!.id))

          if (row!.pinnedIpv4) {
            await applyPinnedIp(mac, row!.pinnedIpv4, hostname || row!.hostname || '')
          }

          req.log.info(
            { mac, firstEnroll: decision.mintToken },
            'enroll: approved, auth key issued'
          )
          return reply.code(200).send({
            authKey,
            ...(deviceToken ? { deviceToken } : {}),
            ...(env.HEADSCALE_LOGIN_SERVER
              ? { loginServer: env.HEADSCALE_LOGIN_SERVER }
              : {}),
            ...(row!.pinnedIpv4 ? { pinnedIp: row!.pinnedIpv4 } : {}),
          })
        }
      }
    }
  )
}

/** ADMIN — cần đăng nhập. Duyệt/thu hồi/reset token/xoá bản ghi enrollment. */
export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // Danh sách. `salt` trả nguyên vẹn cho admin đã đăng nhập; UI mask mặc định
  // và chỉ hiện khi bấm (serial suy ra được private machine key).
  app.get('/api/enrollments', async () => {
    const rows = await db
      .select()
      .from(deviceEnrollment)
      .orderBy(desc(deviceEnrollment.createdAt))
    return rows.map((r) => ({
      ...r,
      // Không bao giờ lộ hash ra ngoài; chỉ cho biết đã có ai claim chưa.
      deviceTokenHash: undefined,
      claimed: !!r.deviceTokenHash,
    }))
  })

  app.post('/api/enrollments/:id/approve', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const b = req.body as { pinnedIpv4?: unknown; note?: unknown }
    const pinnedIpv4 =
      typeof b.pinnedIpv4 === 'string' && b.pinnedIpv4.trim()
        ? b.pinnedIpv4.trim()
        : null
    const note = typeof b.note === 'string' ? b.note.trim() : null

    const [row] = await db
      .select()
      .from(deviceEnrollment)
      .where(eq(deviceEnrollment.id, id))
    if (!row) return reply.code(404).send({ error: 'not_found' })

    await db
      .update(deviceEnrollment)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: req.user?.email ?? null,
        ...(pinnedIpv4 ? { pinnedIpv4 } : {}),
        ...(note ? { note } : {}),
      })
      .where(eq(deviceEnrollment.id, id))

    // Ghim IP ngay khi duyệt, để reserved-ip trả đúng IP ở lần đăng ký đầu tiên.
    if (pinnedIpv4) {
      await applyPinnedIp(row.mac, pinnedIpv4, row.hostname ?? '')
    }
    return { ok: true }
  })

  app.post('/api/enrollments/:id/revoke', async (req) => {
    const id = Number((req.params as { id: string }).id)
    await db
      .update(deviceEnrollment)
      .set({ status: 'revoked' })
      .where(eq(deviceEnrollment.id, id))
    return { ok: true }
  })

  // Máy mất node.xml (mất deviceToken) -> xoá hash để nó claim lại được.
  app.post('/api/enrollments/:id/reset-token', async (req) => {
    const id = Number((req.params as { id: string }).id)
    await db
      .update(deviceEnrollment)
      .set({ deviceTokenHash: null })
      .where(eq(deviceEnrollment.id, id))
    return { ok: true }
  })

  app.delete('/api/enrollments/:id', async (req) => {
    const id = Number((req.params as { id: string }).id)
    await db.delete(deviceEnrollment).where(eq(deviceEnrollment.id, id))
    return { ok: true }
  })

  // Pre-approve: admin nhập (mac, salt) lấy từ `<exe> id` TRƯỚC khi cắm máy,
  // để máy vừa bật là enroll được ngay, không phải chờ vòng pending.
  app.post('/api/enrollments/pre-approve', async (req, reply) => {
    const b = req.body as {
      mac?: unknown
      salt?: unknown
      note?: unknown
      pinnedIpv4?: unknown
    }
    const mac = typeof b.mac === 'string' ? normalizeMac(b.mac) : ''
    const salt = typeof b.salt === 'string' ? normalizeSalt(b.salt) : ''
    if (!mac || !salt) {
      return reply.code(400).send({ error: 'mac and salt required' })
    }
    const note = typeof b.note === 'string' ? b.note.trim() : null
    const pinnedIpv4 =
      typeof b.pinnedIpv4 === 'string' && b.pinnedIpv4.trim()
        ? b.pinnedIpv4.trim()
        : null

    await db
      .insert(deviceEnrollment)
      .values({
        mac,
        salt,
        status: 'approved',
        note,
        pinnedIpv4,
        approvedAt: new Date(),
        approvedBy: req.user?.email ?? null,
      })
      .onConflictDoUpdate({
        target: [deviceEnrollment.mac, deviceEnrollment.salt],
        set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: req.user?.email ?? null,
          ...(note ? { note } : {}),
          ...(pinnedIpv4 ? { pinnedIpv4 } : {}),
        },
      })

    if (pinnedIpv4) await applyPinnedIp(mac, pinnedIpv4, '')
    return { ok: true }
  })
}
