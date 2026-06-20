import { env } from '../env.js'

/** Gọi headscale HTTP API bằng Bearer API key. */
export async function hsApi<T = unknown>(path: string): Promise<T> {
  if (!env.HEADSCALE_API_KEY) throw new Error('no_headscale_key')
  const url = `${env.HEADSCALE_API_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${env.HEADSCALE_API_KEY}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`headscale ${res.status}`)
  return (await res.json()) as T
}

/** Lấy JSON từ node-dedup collector (cùng mạng compose). */
export async function nodededup<T = unknown>(path: string): Promise<T> {
  const url = `${env.NODEDEDUP_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`node-dedup ${res.status}`)
  return (await res.json()) as T
}
