import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAuth } from '../auth/middleware.js'
import { db } from '../db/client.js'
import { vpnDomains, vpnGateways, type VpnGateway } from '../db/schema.js'
import { hashPassword, verifyPassword, dummyVerify } from '../lib/password.js'
import { decryptSecret, encryptSecret } from '../lib/vpn-crypto.js'
import { computeGatewayHealth } from '../lib/vpn-health.js'

/** Loại bí mật trước khi trả ra API admin; phơi cờ "đã có" + health cho UI. */
function maskGateway(g: VpnGateway) {
  const {
    authPasswordEnc,
    agentTokenHash,
    ovpnConfig,
    ...rest
  } = g
  return {
    ...rest,
    hasPass: !!authPasswordEnc,
    hasAgentToken: !!agentTokenHash,
    hasOvpn: !!ovpnConfig,
    // Sức khoẻ suy từ state + reportedAt (cảnh báo khi phiên VPN rớt / agent im lặng).
    health: computeGatewayHealth(g, Date.now()),
  }
}

/** Các field mà agent quan tâm — đổi bất kỳ cái nào thì tăng config_version để
 *  agent áp lại (ghi config + recreate container). ovpnPass = mật khẩu OpenVPN
 *  dạng thô admin gửi lên (mã hoá thành auth_password_enc). */
const AGENT_FIELDS = ['ovpnConfig', 'authUsername', 'ovpnPass', 'proxyPort', 'desiredState'] as const

const createSchema = z.object({
  name: z.string().min(1).max(64),
  nodeHostname: z.string().max(128).nullish(),
  tailnetIp: z.string().max(64).nullish(),
  proxyPort: z.number().int().min(1).max(65535).default(8888),
  ovpnConfig: z.string().max(100_000).nullish(),
  authUsername: z.string().max(256).nullish(),
  ovpnPass: z.string().max(1024).nullish(), // mật khẩu OpenVPN thô -> mã hoá khi lưu
  desiredState: z.enum(['up', 'down']).default('up'),
  enabled: z.boolean().default(true),
})

const updateSchema = createSchema.partial().omit({ name: true })

const domainCreateSchema = z.object({
  gatewayId: z.number().int(),
  domain: z.string().min(1).max(255),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(10),
})

const domainUpdateSchema = z.object({
  domain: z.string().min(1).max(255).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
})

const actionSchema = z.object({ action: z.enum(['start', 'stop', 'restart']) })

const agentStatusSchema = z.object({
  state: z.enum(['up', 'down', 'connecting', 'error']).optional(),
  tunIp: z.string().max(64).nullish(),
  egressIp: z.string().max(64).nullish(),
  // IP tailnet (100.x) node tự báo -> cập nhật vpn_gateways.tailnet_ip để PAC
  // luôn trỏ đúng IP hiện tại, KHÔNG hardcode ở deploy.
  tailnetIp: z.string().max(64).nullish(),
  lastError: z.string().max(2000).nullish(),
  agentVersion: z.string().max(64).nullish(),
})

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin CRUD — yêu cầu đăng nhập.
// ─────────────────────────────────────────────────────────────────────────────
export async function vpnRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // ----- gateways -----
  app.get('/api/vpn/gateways', async () => {
    const rows = await db.select().from(vpnGateways).orderBy(vpnGateways.id)
    return rows.map(maskGateway)
  })

  app.get('/api/vpn/gateways/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const [row] = await db.select().from(vpnGateways).where(eq(vpnGateways.id, id))
    if (!row) return reply.code(404).send({ error: 'not found' })
    return maskGateway(row)
  })

  app.post('/api/vpn/gateways', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const { ovpnPass, ...rest } = parsed.data
    // Sinh agent token — trả THÔ đúng 1 lần, lưu hash.
    const token = newToken()
    const values = {
      ...rest,
      authPasswordEnc: ovpnPass ? encryptSecret(ovpnPass) : null,
      agentTokenHash: await hashPassword(token),
      updatedAt: new Date(),
    }
    try {
      const [row] = await db.insert(vpnGateways).values(values).returning()
      return { ...maskGateway(row), agentToken: token }
    } catch (e) {
      const msg = String(e)
      if (msg.includes('unique') || msg.includes('duplicate'))
        return reply.code(409).send({ error: 'tên gateway đã tồn tại' })
      return reply.code(502).send({ error: msg })
    }
  })

  app.put('/api/vpn/gateways/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const body = parsed.data
    const bumpVersion = AGENT_FIELDS.some((f) => f in body)

    const set: Partial<typeof vpnGateways.$inferInsert> = { updatedAt: new Date() }
    if (body.nodeHostname !== undefined) set.nodeHostname = body.nodeHostname
    if (body.tailnetIp !== undefined) set.tailnetIp = body.tailnetIp
    if (body.proxyPort !== undefined) set.proxyPort = body.proxyPort
    if (body.ovpnConfig !== undefined) set.ovpnConfig = body.ovpnConfig
    if (body.authUsername !== undefined) set.authUsername = body.authUsername
    if (body.desiredState !== undefined) set.desiredState = body.desiredState
    if (body.enabled !== undefined) set.enabled = body.enabled
    if ('ovpnPass' in body) {
      set.authPasswordEnc = body.ovpnPass ? encryptSecret(body.ovpnPass) : null
    }
    if (bumpVersion) {
      const [cur] = await db
        .select({ v: vpnGateways.configVersion })
        .from(vpnGateways)
        .where(eq(vpnGateways.id, id))
      if (!cur) return reply.code(404).send({ error: 'not found' })
      set.configVersion = (cur.v ?? 1) + 1
    }
    const [row] = await db
      .update(vpnGateways)
      .set(set)
      .where(eq(vpnGateways.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return maskGateway(row)
  })

  // Start / Stop / Restart — đổi desired_state + tăng config_version để agent áp.
  app.post('/api/vpn/gateways/:id/action', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = actionSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const [cur] = await db.select().from(vpnGateways).where(eq(vpnGateways.id, id))
    if (!cur) return reply.code(404).send({ error: 'not found' })
    // restart giữ nguyên desired_state nhưng vẫn bump version -> agent recreate.
    const desiredState =
      parsed.data.action === 'start' ? 'up'
      : parsed.data.action === 'stop' ? 'down'
      : cur.desiredState
    const [row] = await db
      .update(vpnGateways)
      .set({
        desiredState,
        configVersion: (cur.configVersion ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(vpnGateways.id, id))
      .returning()
    return maskGateway(row)
  })

  // Xoay agent token — trả token mới THÔ đúng 1 lần.
  app.post('/api/vpn/gateways/:id/rotate-token', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const token = newToken()
    const [row] = await db
      .update(vpnGateways)
      .set({ agentTokenHash: await hashPassword(token), updatedAt: new Date() })
      .where(eq(vpnGateways.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return { ...maskGateway(row), agentToken: token }
  })

  app.delete('/api/vpn/gateways/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    await db.delete(vpnGateways).where(eq(vpnGateways.id, id))
    return { ok: true }
  })

  // ----- domains -----
  app.get('/api/vpn/domains', async (req) => {
    const q = req.query as { gatewayId?: string }
    const gid = q.gatewayId ? Number(q.gatewayId) : null
    if (gid && Number.isFinite(gid)) {
      return db
        .select()
        .from(vpnDomains)
        .where(eq(vpnDomains.gatewayId, gid))
        .orderBy(vpnDomains.priority, vpnDomains.id)
    }
    return db
      .select()
      .from(vpnDomains)
      .orderBy(vpnDomains.priority, vpnDomains.id)
  })

  app.post('/api/vpn/domains', async (req, reply) => {
    const parsed = domainCreateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    try {
      const [row] = await db.insert(vpnDomains).values(parsed.data).returning()
      return row
    } catch (e) {
      const msg = String(e)
      if (msg.includes('unique') || msg.includes('duplicate'))
        return reply.code(409).send({ error: 'domain đã có cho gateway này' })
      if (msg.includes('foreign') || msg.includes('violates'))
        return reply.code(400).send({ error: 'gatewayId không tồn tại' })
      return reply.code(502).send({ error: msg })
    }
  })

  app.put('/api/vpn/domains/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = domainUpdateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db
      .update(vpnDomains)
      .set(parsed.data)
      .where(eq(vpnDomains.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    return row
  })

  app.delete('/api/vpn/domains/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    await db.delete(vpnDomains).where(eq(vpnDomains.id, id))
    return { ok: true }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent — Bearer token per-gateway (KHÔNG dùng session admin). Rate-limit để
// chống dò token. ?gateway=<name> chọn gateway.
// ─────────────────────────────────────────────────────────────────────────────
async function authAgent(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<VpnGateway | null> {
  const auth = req.headers['authorization']
  const token = typeof auth === 'string' && auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : ''
  const q = req.query as { gateway?: string }
  const name = (q.gateway ?? '').trim()
  if (!token || !name) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  const [gw] = await db.select().from(vpnGateways).where(eq(vpnGateways.name, name))
  if (!gw || !gw.agentTokenHash) {
    await dummyVerify(token) // burn thời gian scrypt -> không lộ gateway tồn tại qua timing
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  if (!(await verifyPassword(token, gw.agentTokenHash))) {
    reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  return gw
}

export async function vpnAgentPublicRoutes(app: FastifyInstance): Promise<void> {
  // Agent poll cấu hình (mỗi ~15s). Trả mật khẩu đã GIẢI MÃ — chỉ ở đây.
  app.get(
    '/api/vpn/agent/config',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const gw = await authAgent(req, reply)
      if (!gw) return
      let ovpnPass: string | null = null
      if (gw.authPasswordEnc) {
        try {
          ovpnPass = decryptSecret(gw.authPasswordEnc)
        } catch {
          return reply.code(500).send({ error: 'giai ma mat khau VPN that bai — kiem tra VPN_SECRET_KEY' })
        }
      }
      return {
        name: gw.name,
        configVersion: gw.configVersion,
        desiredState: gw.desiredState,
        proxyPort: gw.proxyPort,
        ovpnConfig: gw.ovpnConfig,
        authUsername: gw.authUsername,
        ovpnPass,
      }
    }
  )

  // Agent báo trạng thái (mỗi ~15s).
  app.post(
    '/api/vpn/agent/status',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const gw = await authAgent(req, reply)
      if (!gw) return
      const parsed = agentStatusSchema.safeParse(req.body)
      if (!parsed.success)
        return reply.code(400).send({ error: parsed.error.flatten() })
      const patch: Partial<typeof vpnGateways.$inferInsert> = {
        ...parsed.data,
        reportedAt: new Date(),
      }
      // Không ghi đè tailnet_ip bằng giá trị rỗng (giữ IP DB nếu agent chưa lấy được).
      if (!patch.tailnetIp) delete patch.tailnetIp
      const [row] = await db
        .update(vpnGateways)
        .set(patch)
        .where(eq(vpnGateways.id, gw.id))
        .returning()
      return { ok: true, configVersion: row?.configVersion ?? gw.configVersion }
    }
  )
}
