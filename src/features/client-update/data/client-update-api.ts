import { api } from '@/lib/api-client'

export type ClientBuild = { build: number; version: string }

export type ClientUpdateConfig = {
  enabled: boolean
  pinnedBuild: number | null
  latestBuild: number | null
  builds: ClientBuild[]
}

export const clientUpdateKeys = { all: ['client-update'] as const }

export async function getClientUpdate(): Promise<ClientUpdateConfig> {
  const { data } = await api.get<ClientUpdateConfig>('/client-update')
  return data
}

export async function putClientUpdate(patch: {
  enabled?: boolean
  pinnedBuild?: number | null
}): Promise<{ enabled: boolean; pinnedBuild: number | null }> {
  const { data } = await api.put('/client-update', patch)
  return data
}

/** "Cập nhật ngay": báo toàn bộ client kiểm tra + cập nhật liền (poll 20s). */
export async function checkNowClientUpdate(): Promise<{
  ok: boolean
  at: string
}> {
  const { data } = await api.post('/client-update/check-now')
  return data
}

export type VersionHistoryRow = {
  id: number
  mac: string | null
  hostname: string | null
  fromBuild: number | null
  toBuild: number | null
  fromVersion: string | null
  toVersion: string | null
  direction: 'initial' | 'upgrade' | 'downgrade'
  changedAt: string
}

/** Lịch sử nâng/hạ cấp build client (toàn fleet, mới nhất trước). */
export async function getVersionHistory(
  limit = 100
): Promise<VersionHistoryRow[]> {
  const { data } = await api.get<VersionHistoryRow[]>(
    '/client-update/history',
    {
      params: { limit },
    }
  )
  return data
}
