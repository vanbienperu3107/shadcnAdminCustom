import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  deviceIdentity,
  folderBrowse,
  folderShareAccess,
  folderShares,
  nodeReloadRequests,
} from '../db/schema.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../env.js'
import { pushTaildrivePolicy } from '../lib/taildrive-policy.js'

/** Kiểm tra X-Headscale-Secret (giống client-runtime / node-assignments). */
function checkSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.HEADSCALE_DASHBOARD_SECRET) return true
  if (req.headers['x-headscale-secret'] === env.HEADSCALE_DASHBOARD_SECRET) return true
  reply.code(401).send({ error: 'unauthorized' })
  return false
}

/** nodeKey headscale của 1 MAC (để poke). */
async function nodeKeyForMac(mac: string): Promise<string | null> {
  const [d] = await db
    .select({ nk: deviceIdentity.nodeKey })
    .from(deviceIdentity)
    .where(eq(deviceIdentity.mac, mac))
  return d?.nk ?? null
}

/** Gọi POST {HEADSCALE_API_URL}/derp/poke?nodeKey=… — chỉ dùng để đánh thức
 *  client sớm cho tính năng folder-browse (client re-poll runtime ngay thay
 *  vì chờ hết chu kỳ 20s); KHÔNG còn liên quan tới cấp quyền Taildrive (việc
 *  đó giờ do headscale tự đọc nodeAttrs/grants từ policy — xem
 *  lib/taildrive-policy.ts). */
async function pokeHeadscale(nodeKey: string): Promise<boolean> {
  const base = env.HEADSCALE_API_URL.replace(/\/+$/, '')
  if (!base) return false
  try {
    const res = await fetch(`${base}/derp/poke?nodeKey=${encodeURIComponent(nodeKey)}`, {
      method: 'POST',
      headers: env.HEADSCALE_DASHBOARD_SECRET
        ? { 'X-Headscale-Secret': env.HEADSCALE_DASHBOARD_SECRET }
        : {},
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Báo cho các node bị ảnh hưởng: bump reload để client re-poll runtime (áp
 *  lại shares/mounts sớm hơn chu kỳ 20s). Việc cấp/thu hồi quyền Taildrive
 *  thật sự (nodeAttrs/grants trong ACL policy của headscale) là việc của
 *  pushTaildrivePolicy() — gọi riêng, MỘT LẦN cho toàn bộ state hiện tại,
 *  không phải theo từng mac (nodeAttrs/grants tính lại từ đầu mỗi lần). */
async function notifyNodes(macs: (string | null | undefined)[]): Promise<void> {
  const uniq = [...new Set(macs.filter((m): m is string => !!m))]
  for (const mac of uniq) {
    await db
      .insert(nodeReloadRequests)
      .values({ mac, requestedAt: new Date() })
      .onConflictDoUpdate({ target: nodeReloadRequests.mac, set: { requestedAt: new Date() } })
  }
  // Best-effort, không chặn mutation: nếu headscale chưa bật
  // POLICY_MODE=database hoặc tạm thời không tới được, DB vẫn ghi đúng ý admin
  // — lần push kế tiếp (mutation sau, hoặc retry thủ công) sẽ đồng bộ lại từ
  // đầu vì pushTaildrivePolicy() luôn tính lại toàn bộ nodeAttrs/grants từ
  // state hiện tại, không phải một diff tăng dần.
  try {
    await pushTaildrivePolicy()
  } catch (e) {
    console.error('folder-share: pushTaildrivePolicy failed:', e instanceof Error ? e.message : e)
  }
}

/**
 * Public — gọi bởi client (browse). Bảo vệ bằng X-Headscale-Secret nếu env
 * được set.
 */
export async function folderSharesPublicRoutes(app: FastifyInstance): Promise<void> {
  // Client poll: có yêu cầu duyệt thư mục nào đang chờ cho MAC này không?
  app.get('/api/client/browse-request', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const q = req.query as { mac?: string }
    if (!q.mac) return { path: null }
    const [r] = await db.select().from(folderBrowse).where(eq(folderBrowse.mac, q.mac))
    const pending = !!r?.requestedAt && (!r.resultAt || r.requestedAt > r.resultAt)
    return { path: pending ? r!.reqPath : null }
  })

  // Client trả kết quả liệt kê thư mục con. folder_browse chỉ có 1 dòng/mac
  // (req_path và res_path chia sẻ dòng đó) — nếu admin đổi sang duyệt path B
  // trong lúc client vẫn đang trả lời path A (đã hỏi trước đó), kết quả A tới
  // SAU sẽ đè lên res_path và bị hiểu lầm là "đã có kết quả mới" cho request
  // hiện tại (B). Chỉ chấp nhận kết quả khi path khớp đúng req_path đang chờ;
  // kết quả trễ/lạc (path khác) bị âm thầm bỏ qua.
  app.post('/api/internal/browse-result', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const parsed = browseResultSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const { mac, path, entries } = parsed.data
    const [row] = await db
      .select({ reqPath: folderBrowse.reqPath })
      .from(folderBrowse)
      .where(eq(folderBrowse.mac, mac))
    if (!row || row.reqPath !== path) {
      return { ok: true, stale: true }
    }
    const now = new Date()
    await db
      .update(folderBrowse)
      .set({ resPath: path, entries: JSON.stringify(entries), resultAt: now })
      .where(eq(folderBrowse.mac, mac))
    return { ok: true }
  })
}

// ---- validation ----
const shareSchema = z.object({
  ownerMac: z.string().min(1),
  ownerHostname: z.string().nullish(),
  // Tên share Taildrive — khớp ĐÚNG validShareName() của gói drive (tailscale):
  // chỉ a-z 0-9 _ ( ) và khoảng trắng; client tự lowercase + trim trước khi
  // gọi `drive share`, nên chuẩn hoá luôn ở đây để hiển thị/so khớp nhất quán
  // (tránh 2 dòng khác hoa/thường tưởng là 2 share khác nhau). .pipe() chạy
  // min/max/regex SAU transform — nếu validate trước (như .transform() nối
  // trực tiếp) thì " " (toàn khoảng trắng) qua được min(1) rồi mới bị trim
  // thành "", lọt validation với giá trị rỗng.
  shareName: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(
      z
        .string()
        .min(1, 'Tên chia sẻ không được để trống')
        .max(64)
        .regex(/^[a-zA-Z0-9_() ]+$/, 'Chỉ dùng chữ, số, dấu gạch dưới, ngoặc đơn hoặc khoảng trắng')
    ),
  localPath: z.string().min(1),
  enabled: z.boolean().default(true),
})

const accessRowSchema = z.object({
  granteeMac: z.string().min(1),
  granteeHostname: z.string().nullish(),
  access: z.enum(['ro', 'rw']).default('rw'),
  autoMount: z.boolean().default(false),
  mountDrive: z.string().nullish(),
  enabled: z.boolean().default(true),
})

const accessListSchema = z.object({ access: z.array(accessRowSchema) })

const browseReqSchema = z.object({ mac: z.string().min(1), path: z.string().min(1) })

const browseResultSchema = z.object({
  mac: z.string().min(1),
  path: z.string(),
  entries: z.array(z.object({ name: z.string(), is_dir: z.boolean() })).max(5000),
})

/** Admin CRUD — yêu cầu đăng nhập. */
export async function folderSharesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  // Danh sách share + access lồng theo share.
  app.get('/api/folder-shares', async () => {
    const shares = await db
      .select()
      .from(folderShares)
      .orderBy(folderShares.ownerHostname, folderShares.shareName)
    const access = await db.select().from(folderShareAccess)
    const byShare = new Map<number, typeof access>()
    for (const a of access) {
      const arr = byShare.get(a.shareId) ?? []
      arr.push(a)
      byShare.set(a.shareId, arr)
    }
    return shares.map((s) => ({ ...s, access: byShare.get(s.id) ?? [] }))
  })

  // Tạo share mới.
  app.post('/api/folder-shares', async (req, reply) => {
    const parsed = shareSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db.insert(folderShares).values(parsed.data).returning()
    await notifyNodes([row.ownerMac])
    return row
  })

  // Sửa share (tên/đường dẫn/bật-tắt). MAC owner không đổi — loại ownerMac
  // khỏi schema (không chỉ khỏi doc-comment) để không thể vô tình repoint 1
  // share sang PC khác qua endpoint này (access grants vẫn khoá theo share_id
  // cũ, nên đổi owner mà giữ access sẽ cấp nhầm quyền vào máy khác).
  app.put('/api/folder-shares/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = shareSchema.omit({ ownerMac: true }).partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const [row] = await db
      .update(folderShares)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(folderShares.id, id))
      .returning()
    if (!row) return reply.code(404).send({ error: 'not found' })
    // Đổi share ảnh hưởng cả owner lẫn mọi grantee của nó.
    const grantees = await db
      .select({ mac: folderShareAccess.granteeMac })
      .from(folderShareAccess)
      .where(eq(folderShareAccess.shareId, id))
    await notifyNodes([row.ownerMac, ...grantees.map((g) => g.mac)])
    return row
  })

  // Xóa share (CASCADE tự xóa access).
  app.delete('/api/folder-shares/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const [share] = await db.select().from(folderShares).where(eq(folderShares.id, id))
    if (!share) return reply.code(404).send({ error: 'not found' })
    const grantees = await db
      .select({ mac: folderShareAccess.granteeMac })
      .from(folderShareAccess)
      .where(eq(folderShareAccess.shareId, id))
    await db.delete(folderShares).where(eq(folderShares.id, id))
    await notifyNodes([share.ownerMac, ...grantees.map((g) => g.mac)])
    return { ok: true }
  })

  // Set toàn bộ ma trận phân quyền của 1 share (replace all).
  app.put('/api/folder-shares/:id/access', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'bad id' })
    const parsed = accessListSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })

    const [share] = await db.select().from(folderShares).where(eq(folderShares.id, id))
    if (!share) return reply.code(404).send({ error: 'not found' })

    const oldGrantees = (
      await db
        .select({ mac: folderShareAccess.granteeMac })
        .from(folderShareAccess)
        .where(eq(folderShareAccess.shareId, id))
    ).map((g) => g.mac)

    await db.transaction(async (tx) => {
      await tx.delete(folderShareAccess).where(eq(folderShareAccess.shareId, id))
      if (parsed.data.access.length > 0) {
        await tx
          .insert(folderShareAccess)
          .values(parsed.data.access.map((a) => ({ ...a, shareId: id })))
      }
    })

    const newGrantees = parsed.data.access.map((a) => a.granteeMac)
    await notifyNodes([share.ownerMac, ...oldGrantees, ...newGrantees])
    return { ok: true, count: parsed.data.access.length }
  })

  // ---- Folder picker (duyệt cây thư mục) ----
  // Admin yêu cầu client liệt kê 1 thư mục.
  app.post('/api/folder-shares/browse', async (req, reply) => {
    const parsed = browseReqSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() })
    const { mac, path } = parsed.data
    const now = new Date()
    await db
      .insert(folderBrowse)
      .values({ mac, reqPath: path, requestedAt: now })
      .onConflictDoUpdate({ target: folderBrowse.mac, set: { reqPath: path, requestedAt: now } })
    // Đánh thức client sớm (poke → client re-poll runtime/browse ngay).
    const nk = await nodeKeyForMac(mac)
    if (nk) await pokeHeadscale(nk)
    return { ok: true }
  })

  // Admin đọc kết quả duyệt mới nhất của 1 MAC.
  app.get('/api/folder-shares/browse/:mac', async (req) => {
    const { mac } = req.params as { mac: string }
    const [r] = await db.select().from(folderBrowse).where(eq(folderBrowse.mac, mac))
    if (!r) return { pending: false, resPath: null, entries: [] as unknown[] }
    const pending = !!r.requestedAt && (!r.resultAt || r.requestedAt > r.resultAt)
    let entries: unknown[] = []
    try {
      entries = r.entries ? JSON.parse(r.entries) : []
    } catch {
      entries = []
    }
    return {
      pending,
      reqPath: r.reqPath,
      resPath: r.resPath,
      entries,
      resultAt: r.resultAt ? r.resultAt.toISOString() : null,
    }
  })
}
