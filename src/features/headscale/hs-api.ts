import { api } from '@/lib/api-client'

export type HsMachine = {
  id?: string
  name?: string
  givenName?: string
  nodeKey?: string // e.g. "nodekey:abc123..." — dùng cho Feature B per-node DERPMap
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
  acl: ['hs', 'acl'] as const,
  routes: ['hs', 'routes'] as const,
  preauthkeys: (user: string) => ['hs', 'preauthkeys', user] as const,
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

// ── ACL ──────────────────────────────────────────────────────────────────────

export async function fetchAcl(): Promise<{
  configured: boolean
  policy: string
}> {
  const { data } = await api.get('/acl')
  return data
}

export async function updateAcl(policy: string): Promise<void> {
  await api.post('/acl', { policy })
}

// ── Routes ───────────────────────────────────────────────────────────────────

export type HsRoute = {
  id?: string
  prefix?: string
  node?: { givenName?: string; name?: string; id?: string }
  enabled?: boolean
  isPrimary?: boolean
  updatedAt?: string
}

export async function fetchRoutes(): Promise<{
  configured: boolean
  routes: HsRoute[]
}> {
  const { data } = await api.get('/routes')
  return data
}

export async function enableRoute(id: string): Promise<void> {
  await api.post(`/routes/${id}/enable`, {})
}

export async function deleteRoute(id: string): Promise<void> {
  await api.delete(`/routes/${id}`)
}

// ── Pre-auth keys ─────────────────────────────────────────────────────────────

export type HsPreAuthKey = {
  id?: string
  key?: string
  user?: string
  reusable?: boolean
  ephemeral?: boolean
  used?: boolean
  expiration?: string
}

export async function fetchPreAuthKeys(user: string): Promise<HsPreAuthKey[]> {
  const { data } = await api.get(`/users/${user}/preauthkeys`)
  return data?.preAuthKeys ?? []
}

export async function createPreAuthKey(opts: {
  user: string
  reusable: boolean
  ephemeral: boolean
  expiration: string
}): Promise<HsPreAuthKey> {
  const { data } = await api.post('/preauthkeys', opts)
  return data?.preAuthKey ?? {}
}

export async function expirePreAuthKey(
  user: string,
  key: string
): Promise<void> {
  await api.post(`/users/${user}/preauthkeys/expire`, { key })
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
