import { env } from '../env.js'

/**
 * Đọc trạng thái máy chủ từ Beszel (PocketBase) cho trang Monitor.
 *
 * Gọi thẳng beszel:8090 qua mạng docker memnet (không qua Caddy/SSO) bằng
 * superuser. Token cache trong RAM, hết hạn/401 thì đăng nhập lại đúng 1 lần.
 */

export type MonitorStatus = 'up' | 'down' | 'paused' | 'pending'

export type MonitorSystem = {
  id: string
  name: string
  status: MonitorStatus
  cpu: number | null
  mem: number | null
  disk: number | null
  load: [number, number, number] | null
  /** Tổng băng thông, byte/giây. */
  netBps: number | null
  uptimeSec: number | null
  agent: string | null
  updated: string | null
}

type BeszelRecord = {
  id: string
  name: string
  status?: string
  updated?: string
  v?: string
  info?: {
    cpu?: number
    mp?: number
    dp?: number
    la?: [number, number, number]
    b?: number
    bb?: number
    u?: number
    v?: string
  }
}

const TIMEOUT_MS = 8_000
const STATUSES: MonitorStatus[] = ['up', 'down', 'paused', 'pending']

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Chuẩn hóa 1 record `systems` của Beszel sang hình dạng trang Monitor dùng. */
export function mapSystem(r: BeszelRecord): MonitorSystem {
  const i = r.info ?? {}
  const la =
    Array.isArray(i.la) && i.la.length === 3 && i.la.every((x) => num(x) !== null)
      ? (i.la as [number, number, number])
      : null
  // bb (byte/s) có từ agent mới; bản cũ chỉ có b (MB/s).
  const netBps = num(i.bb) ?? (num(i.b) !== null ? (i.b as number) * 1024 * 1024 : null)
  return {
    id: r.id,
    name: r.name,
    status: STATUSES.includes(r.status as MonitorStatus)
      ? (r.status as MonitorStatus)
      : 'pending',
    cpu: num(i.cpu),
    mem: num(i.mp),
    disk: num(i.dp),
    load: la,
    netBps,
    uptimeSec: num(i.u),
    agent: i.v || r.v || null,
    updated: r.updated || null,
  }
}

export function beszelConfigured(): boolean {
  return !!(env.BESZEL_EMAIL && env.BESZEL_PASSWORD)
}

let token: string | null = null

function base(): string {
  return env.BESZEL_URL.replace(/\/$/, '')
}

async function login(): Promise<string> {
  const res = await fetch(`${base()}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: env.BESZEL_EMAIL, password: env.BESZEL_PASSWORD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`beszel login HTTP ${res.status}`)
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('beszel login: thiếu token')
  token = body.token
  return token
}

async function getRecords(tok: string): Promise<Response> {
  return fetch(`${base()}/api/collections/systems/records?perPage=200&sort=name`, {
    headers: { Authorization: tok },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

export async function fetchSystems(): Promise<MonitorSystem[]> {
  let res = await getRecords(token ?? (await login()))
  if (res.status === 401 || res.status === 403) {
    res = await getRecords(await login())
  }
  if (!res.ok) throw new Error(`beszel systems HTTP ${res.status}`)
  const body = (await res.json()) as { items?: BeszelRecord[] }
  return (body.items ?? []).map(mapSystem)
}

/** Chỉ dùng trong test. */
export function resetBeszelToken(): void {
  token = null
}
