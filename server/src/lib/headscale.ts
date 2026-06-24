import { env } from '../env.js'
import { getApiKey } from './apikey-manager.js'

/** Gọi headscale HTTP API bằng Bearer API key (đọc từ DB, fallback env). */
export async function hsApi<T = unknown>(
  path: string,
  init?: Omit<RequestInit, 'headers' | 'signal'>,
): Promise<T> {
  const key = await getApiKey()
  if (!key) throw new Error('no_headscale_key')
  const url = `${env.HEADSCALE_API_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      ...(init?.body != null ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const err = new Error(`headscale ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

/** Headscale status có một số endpoint không tồn tại (tuỳ bản build). */
export function isHsNotFound(e: unknown): boolean {
  return e instanceof Error && (e as Error & { status?: number }).status === 404
}

/** Kiểm tra xem đã có API key cấu hình chưa (DB hoặc env). */
export async function isHsConfigured(): Promise<boolean> {
  const key = await getApiKey()
  return !!key
}

/** Lấy JSON từ node-dedup collector (cùng mạng compose). */
export async function nodededup<T = unknown>(path: string): Promise<T> {
  const url = `${env.NODEDEDUP_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`node-dedup ${res.status}`)
  return (await res.json()) as T
}
