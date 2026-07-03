import { api } from '@/lib/api-client'

export type HsMachine = {
  id?: string
  name?: string
  givenName?: string
  nodeKey?: string // e.g. "nodekey:abc123..." — dùng cho Feature B per-node DERPMap
  user?: { name?: string; displayName?: string; email?: string } | string
  ipAddresses?: string[]
  online?: boolean
  lastSeen?: string
}

export type HsUser = {
  id?: string
  name?: string
  displayName?: string
  email?: string
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

export async function deleteMachine(id: string): Promise<void> {
  await api.delete(`/machines/${encodeURIComponent(id)}`)
}

export async function renameMachine(id: string, name: string): Promise<void> {
  await api.post(`/machines/${encodeURIComponent(id)}/rename`, { name })
}

export async function expireMachine(id: string): Promise<void> {
  await api.post(`/machines/${encodeURIComponent(id)}/expire`, {})
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
  if (typeof u === 'string') return u || '—'
  // user.name có thể rỗng (vd OIDC) → fallback displayName -> email.
  return u.name || u.displayName || u.email || '—'
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
  node?: {
    givenName?: string
    name?: string
    id?: string
    user?: { name?: string; displayName?: string; email?: string } | string
    online?: boolean
  }
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
  // id dạng "<nodeId>|<prefix>" (prefix chứa '/') → encode để an toàn trên path.
  await api.post(`/routes/${encodeURIComponent(id)}/enable`, {})
}

export async function deleteRoute(id: string): Promise<void> {
  await api.delete(`/routes/${encodeURIComponent(id)}`)
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

export async function fetchPreAuthKeys(
  user: string
): Promise<{ preAuthKeys: HsPreAuthKey[] }> {
  const { data } = await api.get(`/users/${user}/preauthkeys`)
  return { preAuthKeys: data?.preAuthKeys ?? [] }
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

/**
 * Tập tên node hạ tầng DERP — HỢP cả `node_name` (admin gõ tay khi tạo/sửa
 * region trên derp_servers) và tên suy từ hostname (`vpn5.hangocthanh.io.vn`
 * -> "vpn5"), không chọn 1 trong 2. Trước đây CHỈ suy từ hostname nên đổi
 * hostname không theo mẫu "vpnN..." làm rớt khỏi tập. Đổi sang CHỈ ưu tiên
 * node_name lại hỏng ngược — nếu node_name khác given-name thật trên headscale
 * (vd để trống, gõ nhầm, hoặc là mã region thay vì tên node) thì cả 2 nguồn
 * đều cần cộng dồn để không bỏ sót trường hợp nào.
 * 'collector' luôn có mặt (sidecar cho node-dedup, không phải 1 dòng derp_servers).
 */
export function derpNameSet(
  derp: { nodeName?: string; hostname: string; code: string }[]
): Set<string> {
  const s = new Set<string>(['collector'])
  for (const d of derp) {
    const fromNodeName = d.nodeName?.toLowerCase().trim()
    const fromHostname = d.hostname.split('.')[0]?.toLowerCase().trim()
    if (fromNodeName) s.add(fromNodeName)
    if (fromHostname) s.add(fromHostname)
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
