import { api } from '@/lib/api-client'

export const pacRuleKeys = {
  all: ['pac-rules'] as const,
}

export type PacRule = {
  id: number
  scope: 'global' | 'node'
  mac: string | null
  kind: 'domain' | 'subnet'
  pattern: string
  proxyTarget: string
  priority: number
  enabled: boolean
  createdAt: string
}

export type PacRuleInput = {
  scope: 'global' | 'node'
  mac?: string | null
  kind: 'domain' | 'subnet'
  pattern: string
  proxyTarget: string
  priority?: number
  enabled?: boolean
}

export async function listPacRules(): Promise<PacRule[]> {
  const { data } = await api.get<PacRule[]>('/pac-rules')
  return data
}

export async function createPacRule(body: PacRuleInput): Promise<PacRule> {
  const { data } = await api.post<PacRule>('/pac-rules', body)
  return data
}

export async function updatePacRule(
  id: number,
  body: Partial<PacRuleInput>
): Promise<PacRule> {
  const { data } = await api.put<PacRule>(`/pac-rules/${id}`, body)
  return data
}

export async function deletePacRule(id: number): Promise<void> {
  await api.delete(`/pac-rules/${id}`)
}

export async function togglePacRule(id: number): Promise<PacRule> {
  const { data } = await api.post<PacRule>(`/pac-rules/${id}/toggle`)
  return data
}

export async function previewPac(mac?: string): Promise<string> {
  const { data } = await api.get<string>('/pac-rules/preview', {
    params: mac ? { mac } : undefined,
    responseType: 'text',
  })
  return data
}
