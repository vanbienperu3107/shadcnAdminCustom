import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { clientUpdate } from '../db/schema.js'
import { env } from '../env.js'
import { requireAuth } from '../auth/middleware.js'

/**
 * Auto-update portable client. Nguồn binary = GitHub Release của
 * CLIENT_RELEASE_REPO (build-windows-portable.yml). Quy ước CI:
 *   - notes body chứa dòng `build: <N>` (N = github.run_number, tăng đơn điệu →
 *     khóa so sánh). Tag vẫn là version (v1.98.4-…), không dùng để so sánh.
 *   - mỗi biến thể có 1 asset exe + 1 asset `<exe>.sha256` (đã có sẵn):
 *       vpn      → tailscale-node-vpn-windows-amd64-*.exe
 *       portable → tailscale-node-portable-windows-amd64-*.exe
 *       linux-amd64 → tailscale-node-linux-amd64-*
 * Client gửi variant + build hiện tại; server trả url + sha256 của đúng biến thể
 * ở build đích (mới nhất, hoặc build được pin — hỗ trợ cả rollback).
 */

type GhAsset = { name?: string; browser_download_url?: string }
type GhRelease = {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GhAsset[]
}

type Release = {
  build: number
  version: string
  assets: GhAsset[]
}

type LatestResult = {
  enabled: boolean
  build?: number
  version?: string
  url?: string
  sha256?: string
}

const VARIANT_RE: Record<string, RegExp> = {
  vpn: /tailscale-node-vpn-windows-amd64-.*\.exe$/i,
  portable: /tailscale-node-portable-windows-amd64-.*\.exe$/i,
  'linux-amd64': /tailscale-node-linux-amd64-[^.]*$/i,
}

const CACHE_MS = 5 * 60_000
let cache: { at: number; releases: Release[] } | null = null
const shaCache = new Map<string, string>() // asset.name → sha256 hex

function parseBuild(body: string | undefined): number | null {
  const m = /^\s*build:\s*(\d+)\s*$/im.exec(body ?? '')
  return m ? Number(m[1]) : null
}

/** Đọc + chuẩn hóa releases (cache 5′). Bỏ draft/prerelease và release không
 *  có `build:`. Sắp build giảm dần. */
async function loadReleases(nowMs: number): Promise<Release[]> {
  if (cache && nowMs - cache.at < CACHE_MS) return cache.releases
  if (!env.GITHUB_TOKEN || !env.CLIENT_RELEASE_REPO) {
    cache = { at: nowMs, releases: [] }
    return []
  }
  const res = await fetch(
    `https://api.github.com/repos/${env.CLIENT_RELEASE_REPO}/releases?per_page=30`,
    {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'derp-dashboard',
      },
      signal: AbortSignal.timeout(8000),
    }
  )
  if (!res.ok) throw new Error(`github releases ${res.status}`)
  const list = (await res.json()) as GhRelease[]
  const releases: Release[] = []
  for (const r of list) {
    if (r.draft || r.prerelease) continue
    const build = parseBuild(r.body)
    if (build == null) continue
    releases.push({
      build,
      version: r.name || r.tag_name || `build-${build}`,
      assets: r.assets ?? [],
    })
  }
  releases.sort((a, b) => b.build - a.build)
  cache = { at: nowMs, releases }
  return releases
}

/** Chọn release đích theo config: pin → đúng build đó; không pin → mới nhất.
 *  Thuần (không I/O) để unit-test được phần logic chọn build. */
export function pickRelease(
  releases: Release[],
  cfg: { enabled: boolean; pinnedBuild: number | null }
): Release | null {
  if (!cfg.enabled) return null
  if (cfg.pinnedBuild != null)
    return releases.find((r) => r.build === cfg.pinnedBuild) ?? null
  return releases[0] ?? null
}

/** Lấy sha256 (hex) của 1 asset từ asset `<name>.sha256` cùng release. Cache theo
 *  tên asset (bất biến theo build). Format file: `<hex>  <filename>`. */
async function fetchSha256(assets: GhAsset[], exeName: string): Promise<string | null> {
  const cached = shaCache.get(exeName)
  if (cached) return cached
  const shaAsset = assets.find((a) => a.name === `${exeName}.sha256`)
  if (!shaAsset?.browser_download_url) return null
  const res = await fetch(shaAsset.browser_download_url, {
    headers: { 'user-agent': 'derp-dashboard' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const text = await res.text()
  const m = /([0-9a-fA-F]{64})/.exec(text)
  if (!m) return null
  const hex = m[1].toLowerCase()
  shaCache.set(exeName, hex)
  return hex
}

function checkSecret(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.HEADSCALE_DASHBOARD_SECRET) return true
  if (req.headers['x-headscale-secret'] === env.HEADSCALE_DASHBOARD_SECRET)
    return true
  reply.code(401).send({ error: 'unauthorized' })
  return false
}

async function loadConfig(): Promise<{ enabled: boolean; pinnedBuild: number | null }> {
  const [row] = await db.select().from(clientUpdate).where(eq(clientUpdate.id, 1))
  return { enabled: row?.enabled ?? false, pinnedBuild: row?.pinnedBuild ?? null }
}

/** Public — client gọi để biết có bản mới không cho biến thể của nó.
 *  GET /api/client/latest?variant=vpn  (guard X-Headscale-Secret). */
export async function clientUpdatePublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/client/latest', async (req, reply) => {
    if (!checkSecret(req, reply)) return
    const variant = String((req.query as { variant?: string }).variant ?? 'portable')
    const re = VARIANT_RE[variant]
    if (!re) return { enabled: false } satisfies LatestResult
    try {
      const [cfg, releases] = await Promise.all([loadConfig(), loadReleases(Date.now())])
      const target = pickRelease(releases, cfg)
      if (!target) return { enabled: false } satisfies LatestResult
      const exe = target.assets.find((a) => a.name && re.test(a.name))
      if (!exe?.name || !exe.browser_download_url) return { enabled: false }
      const sha256 = await fetchSha256(target.assets, exe.name)
      if (!sha256) return { enabled: false } // không có sha256 → không cho update
      return {
        enabled: true,
        build: target.build,
        version: target.version,
        url: exe.browser_download_url,
        sha256,
      } satisfies LatestResult
    } catch (e) {
      req.log.warn({ err: String(e) }, 'client/latest failed')
      return { enabled: false } satisfies LatestResult
    }
  })
}

const putSchema = z.object({
  enabled: z.boolean().optional(),
  pinnedBuild: z.number().int().positive().nullable().optional(),
})

/** Admin — bật/tắt auto-update + pin build, và xem release hiện có. */
export async function clientUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  app.get('/api/client-update', async () => {
    const cfg = await loadConfig()
    let builds: { build: number; version: string }[] = []
    try {
      const releases = await loadReleases(Date.now())
      builds = releases.map((r) => ({ build: r.build, version: r.version }))
    } catch {
      /* trả config kể cả khi GitHub lỗi */
    }
    return { ...cfg, latestBuild: builds[0]?.build ?? null, builds }
  })

  app.put('/api/client-update', async (req, reply) => {
    const parsed = putSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid', details: parsed.error.flatten() })
    }
    const patch: { enabled?: boolean; pinnedBuild?: number | null; updatedAt: Date } = {
      updatedAt: new Date(),
    }
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
    if (parsed.data.pinnedBuild !== undefined) patch.pinnedBuild = parsed.data.pinnedBuild
    await db
      .insert(clientUpdate)
      .values({ id: 1, ...patch })
      .onConflictDoUpdate({ target: clientUpdate.id, set: patch })
    return loadConfig()
  })

  // "Cập nhật ngay": touch update_check_at = now(). Mọi client thấy qua
  // /api/client/runtime (poll 20s) → chạy self-update check liền cho toàn fleet.
  app.post('/api/client-update/check-now', async () => {
    const now = new Date()
    await db
      .insert(clientUpdate)
      .values({ id: 1, updateCheckAt: now })
      .onConflictDoUpdate({ target: clientUpdate.id, set: { updateCheckAt: now } })
    return { ok: true, at: now.toISOString() }
  })
}
