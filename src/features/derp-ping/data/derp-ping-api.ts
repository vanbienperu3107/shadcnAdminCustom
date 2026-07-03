import { api } from '@/lib/api-client'

export const derpPingKeys = {
  all: ['derp-ping'] as const,
}

export type DerpPingRow = {
  client: string // mac
  regionId: number
  regionCode: string | null
  rttMs: number | null
  ok: boolean
  reportedAt: string
}

export async function listDerpPing(): Promise<DerpPingRow[]> {
  const { data } = await api.get<DerpPingRow[]>('/telemetry/derp-ping')
  return data
}
