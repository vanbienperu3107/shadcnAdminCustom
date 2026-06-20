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
