/**
 * Quản lý Headscale API key:
 * - Lưu key duy nhất trong DB (id=1 luôn cố định).
 * - Auto-refresh mỗi 24h: tạo key mới, expire tất cả key cũ trên headscale.
 * - Bootstrap: nếu DB rỗng, seed từ HEADSCALE_API_KEY env var (chỉ lần đầu).
 */
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { headscaleApiKey } from '../db/schema.js'
import { env } from '../env.js'

let cached: string | null = null
let timer: ReturnType<typeof setInterval> | null = null

// ──────────────────────────────────────────────────────────────────
// Đọc key
// ──────────────────────────────────────────────────────────────────
export async function getApiKey(): Promise<string | null> {
  if (cached) return cached
  const rows = await db.select().from(headscaleApiKey).where(eq(headscaleApiKey.id, 1))
  if (rows[0]?.apiKey) {
    cached = rows[0].apiKey
    return cached
  }
  return null
}

// ──────────────────────────────────────────────────────────────────
// Lưu key (upsert đơn dòng)
// ──────────────────────────────────────────────────────────────────
export async function setApiKey(key: string): Promise<void> {
  const prefix = key.split('.')[0] ?? null
  await db
    .insert(headscaleApiKey)
    .values({ id: 1, apiKey: key, prefix, seededAt: new Date() })
    .onConflictDoUpdate({
      target: headscaleApiKey.id,
      set: { apiKey: key, prefix, seededAt: new Date(), refreshedAt: null },
    })
  cached = key
}

// ──────────────────────────────────────────────────────────────────
// Status (cho UI)
// ──────────────────────────────────────────────────────────────────
export async function getApiKeyStatus(): Promise<{
  configured: boolean
  prefix: string | null
  seededAt: string | null
  refreshedAt: string | null
  nextRefreshAt: string | null
}> {
  const rows = await db.select().from(headscaleApiKey).where(eq(headscaleApiKey.id, 1))
  if (!rows[0]) {
    return { configured: false, prefix: null, seededAt: null, refreshedAt: null, nextRefreshAt: null }
  }
  const r = rows[0]
  const base = r.refreshedAt ?? r.seededAt
  const nextRefreshAt = base
    ? new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null
  return {
    configured: true,
    prefix: r.prefix ? `${r.prefix.slice(0, 8)}…` : null,
    seededAt: r.seededAt?.toISOString() ?? null,
    refreshedAt: r.refreshedAt?.toISOString() ?? null,
    nextRefreshAt,
  }
}

// ──────────────────────────────────────────────────────────────────
// Xoay vòng key (gọi headscale API tạo key mới, expire key cũ)
// ──────────────────────────────────────────────────────────────────
export async function refreshApiKey(): Promise<string> {
  const currentKey = await getApiKey()
  if (!currentKey) throw new Error('no_key_to_refresh — seed a key first')

  const base = env.HEADSCALE_API_URL.replace(/\/$/, '')
  const expiry = new Date()
  expiry.setFullYear(expiry.getFullYear() + 1)

  // 1. Tạo key mới
  const createRes = await fetch(`${base}/api/v1/apikeys`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${currentKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiration: expiry.toISOString() }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!createRes.ok) {
    const msg = await createRes.text().catch(() => '')
    throw new Error(`headscale create apikey ${createRes.status}: ${msg}`)
  }
  const { apiKey: newKey } = (await createRes.json()) as { apiKey: string }
  const newPrefix = newKey.split('.')[0] ?? null

  // 2. Lưu key mới vào DB ngay (trước khi expire để không mất key)
  await db
    .insert(headscaleApiKey)
    .values({ id: 1, apiKey: newKey, prefix: newPrefix, seededAt: new Date(), refreshedAt: new Date() })
    .onConflictDoUpdate({
      target: headscaleApiKey.id,
      set: { apiKey: newKey, prefix: newPrefix, refreshedAt: new Date() },
    })
  cached = newKey

  // 3. Expire tất cả key cũ (không fatal nếu lỗi)
  try {
    const listRes = await fetch(`${base}/api/v1/apikeys`, {
      headers: { authorization: `Bearer ${newKey}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (listRes.ok) {
      const { apiKeys } = (await listRes.json()) as { apiKeys?: { prefix: string }[] }
      const old = (apiKeys ?? []).map((k) => k.prefix).filter((p) => p !== newPrefix)
      if (old.length > 0) {
        await fetch(`${base}/api/v1/apikeys/expire`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${newKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ apiKeys: old }),
          signal: AbortSignal.timeout(8_000),
        })
      }
    }
  } catch {
    // Non-fatal: key cũ hết hạn tự nhiên sau 1 năm
  }

  return newKey
}

// ──────────────────────────────────────────────────────────────────
// Auto-refresh mỗi 24h
// ──────────────────────────────────────────────────────────────────
export function startAutoRefresh(log: (msg: string) => void = console.log): void {
  if (timer) return
  const interval = 24 * 60 * 60 * 1000
  timer = setInterval(async () => {
    log('[apikey] auto-refresh triggered')
    try {
      await refreshApiKey()
      log('[apikey] auto-refresh OK')
    } catch (err) {
      console.error('[apikey] auto-refresh failed:', err)
    }
  }, interval)
  timer.unref?.()
  log('[apikey] auto-refresh scheduled (24h interval)')
}

export function stopAutoRefresh(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// ──────────────────────────────────────────────────────────────────
// Seed từ env var (chỉ nếu DB rỗng — gọi 1 lần lúc boot)
// ──────────────────────────────────────────────────────────────────
export async function seedFromEnv(): Promise<boolean> {
  if (!env.HEADSCALE_API_KEY) return false
  const existing = await getApiKey()
  if (existing) return false // DB đã có key, không ghi đè
  await setApiKey(env.HEADSCALE_API_KEY)
  return true
}
