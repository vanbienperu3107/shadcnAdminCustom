import { api } from '@/lib/api-client'

export const homeDerpKeys = {
  all: ['home-derp'] as const,
}

export type HomeDerpRow = {
  mac: string
  hostname: string
  homeRegionId: number | null
  homeRegionCode: string | null
  controllerLatencyMs: number | null
  reportedAt: string
}

export async function listHomeDerp(): Promise<HomeDerpRow[]> {
  const { data } = await api.get<HomeDerpRow[]>('/telemetry/home-derp')
  return data
}
