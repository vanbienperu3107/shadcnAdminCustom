import { api } from '@/lib/api-client'

export const dnsSplitKeys = {
  all: ['dns-split'] as const,
}

export type DnsSplitRule = {
  id: number
  domain: string
  nameservers: string // CSV
  note: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type DnsSplitRuleInput = {
  domain: string
  nameservers: string
  note?: string | null
  enabled?: boolean
}

export async function listDnsSplit(): Promise<DnsSplitRule[]> {
  const { data } = await api.get<DnsSplitRule[]>('/dns-split')
  return data
}

export async function createDnsSplit(
  body: DnsSplitRuleInput
): Promise<DnsSplitRule> {
  const { data } = await api.post<DnsSplitRule>('/dns-split', body)
  return data
}

export async function updateDnsSplit(
  id: number,
  body: Partial<DnsSplitRuleInput>
): Promise<DnsSplitRule> {
  const { data } = await api.patch<DnsSplitRule>(`/dns-split/${id}`, body)
  return data
}

export async function deleteDnsSplit(id: number): Promise<void> {
  await api.delete(`/dns-split/${id}`)
}
