import { api } from '@/lib/api-client'

export const vpnKeys = {
  gateways: ['vpn-gateways'] as const,
  domains: (gatewayId: number) => ['vpn-domains', gatewayId] as const,
}

export type VpnHealthStatus =
  | 'healthy'
  | 'connecting'
  | 'down'
  | 'stale'
  | 'stopped'
  | 'unknown'

export type VpnHealth = { status: VpnHealthStatus; ageSec: number | null }

export type VpnGateway = {
  id: number
  name: string
  nodeHostname: string | null
  tailnetIp: string | null
  proxyPort: number
  desiredState: 'up' | 'down'
  configVersion: number
  enabled: boolean
  state: string | null
  tunIp: string | null
  egressIp: string | null
  lastError: string | null
  agentVersion: string | null
  reportedAt: string | null
  hasPass: boolean
  hasAgentToken: boolean
  hasOvpn: boolean
  health: VpnHealth
  createdAt: string
  updatedAt: string
}

export type VpnDomain = {
  id: number
  gatewayId: number
  domain: string
  enabled: boolean
  priority: number
  createdAt: string
}

export async function listGateways(): Promise<VpnGateway[]> {
  const { data } = await api.get<VpnGateway[]>('/vpn/gateways')
  return data
}

export async function gatewayAction(
  id: number,
  action: 'start' | 'stop' | 'restart'
): Promise<VpnGateway> {
  const { data } = await api.post<VpnGateway>(`/vpn/gateways/${id}/action`, {
    action,
  })
  return data
}

export async function listDomains(gatewayId?: number): Promise<VpnDomain[]> {
  const { data } = await api.get<VpnDomain[]>('/vpn/domains', {
    params: gatewayId ? { gatewayId } : undefined,
  })
  return data
}

export async function createDomain(body: {
  gatewayId: number
  domain: string
  enabled?: boolean
  priority?: number
}): Promise<VpnDomain> {
  const { data } = await api.post<VpnDomain>('/vpn/domains', body)
  return data
}

export async function updateDomain(
  id: number,
  body: Partial<{ domain: string; enabled: boolean; priority: number }>
): Promise<VpnDomain> {
  const { data } = await api.put<VpnDomain>(`/vpn/domains/${id}`, body)
  return data
}

export async function deleteDomain(id: number): Promise<void> {
  await api.delete(`/vpn/domains/${id}`)
}
