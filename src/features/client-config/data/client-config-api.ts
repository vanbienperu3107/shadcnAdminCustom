import { api } from '@/lib/api-client'

export type ClientConfigRow = {
  key: string
  value: string
  note: string | null
  updatedAt: string
}

export type ClientPort = {
  client: string
  portSocks5: number | null
  portHttp: number | null
  reportedAt: string
}

export const configKeys = {
  all: ['client-config'] as const,
  ports: ['client-config', 'ports'] as const,
}

export async function listClientConfig(): Promise<ClientConfigRow[]> {
  const res = await api.get<{ configs: ClientConfigRow[] }>('/client-config')
  return res.data.configs
}

export async function updateClientConfig(key: string, value: string): Promise<ClientConfigRow> {
  const res = await api.put<ClientConfigRow>(`/client-config/${key}`, { value })
  return res.data
}

export async function listClientPorts(): Promise<ClientPort[]> {
  const res = await api.get<{ ports: ClientPort[] }>('/client-config/ports')
  return res.data.ports
}
