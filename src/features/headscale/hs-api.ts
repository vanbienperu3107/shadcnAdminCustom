import { api } from '@/lib/api-client'

export type HsMachine = {
  id?: string
  name?: string
  givenName?: string
  user?: { name?: string } | string
  ipAddresses?: string[]
  online?: boolean
  lastSeen?: string
}

export type HsUser = {
  id?: string
  name?: string
  createdAt?: string
}

export const hsKeys = {
  machines: ['hs', 'machines'] as const,
  users: ['hs', 'users'] as const,
  latency: ['hs', 'latency'] as const,
  ci: ['hs', 'ci'] as const,
  apiKey: ['settings', 'apikey'] as const,
}

export type CiRun = {
  repo: string
  name: string
  status: string
  conclusion: string | null
  headBranch: string
  event: string
  createdAt: string
  htmlUrl: string
}

export async function fetchCi(): Promise<{
  configured: boolean
  runs: CiRun[]
  error?: string
}> {
  const { data } = await api.get('/ci')
  return data
}

export async function fetchMachines(): Promise<{
  configured: boolean
  nodes: HsMachine[]
}> {
  const { data } = await api.get('/machines')
  return data
}

export async function fetchHsUsers(): Promise<{
  configured: boolean
  users: HsUser[]
}> {
  const { data } = await api.get('/users')
  return data
}

export async function fetchLatency(): Promise<{
  window_s?: number
  pairs?: Record<string, unknown>[]
  error?: string
}> {
  const { data } = await api.get('/latency')
  return data
}

export function userName(u: HsMachine['user']): string {
  if (!u) return '—'
  return typeof u === 'string' ? u : (u.name ?? '—')
}

export type ApiKeyStatus = {
  configured: boolean
  prefix: string | null
  seededAt: string | null
  refreshedAt: string | null
  nextRefreshAt: string | null
  error?: string
}

export async function fetchApiKeyStatus(): Promise<ApiKeyStatus> {
  const { data } = await api.get<ApiKeyStatus>('/settings/apikey')
  return data
}

export async function apiKeyRefresh(): Promise<ApiKeyStatus> {
  const { data } = await api.post<ApiKeyStatus>('/settings/apikey/refresh')
  return data
}


/** Tập tên node hạ tầng DERP (vpn2..vpn6 + collector) suy từ danh sách DERP. */
export function derpNameSet(
  derp: { hostname: string; code: string }[]
): Set<string> {
  const s = new Set<string>(['collector', 'vpn2'])
  for (const d of derp) {
    const short = d.hostname.split('.')[0]?.toLowerCase()
    if (short) s.add(short)
  }
  return s
}

/** Node này là hạ tầng DERP (không phải thiết bị người dùng)? */
export function isDerpNode(
  name: string | undefined,
  names: Set<string>
): boolean {
  const n = (name ?? '').toLowerCase()
  if (!n) return false
  if (names.has(n)) return true
  for (const d of names) {
    if (n === d || n.startsWith(d + '-') || n.startsWith(d + '.')) return true
  }
  return false
}
