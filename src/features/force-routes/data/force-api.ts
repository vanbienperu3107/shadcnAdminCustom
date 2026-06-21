import { api } from '@/lib/api-client'

export const forceKeys = {
  all: ['force-routes'] as const,
}

export type ForceRoute = {
  id: number
  regionId: number
  clientIp: string
  label: string | null
  active: boolean
  createdAt: string
  derpCode: string | null
  derpName: string | null
  derpHostname: string | null
  sshUser: string | null
  sshPort: number | null
}

export type SyncResult = {
  ok: boolean
  steps: string[]
  error?: string
}

export async function listForceRoutes(): Promise<ForceRoute[]> {
  const { data } = await api.get<ForceRoute[]>('/force-routes')
  return data
}

export async function createForceRoute(body: {
  regionId: number
  clientIp: string
  label?: string
  active?: boolean
}): Promise<ForceRoute> {
  const { data } = await api.post<ForceRoute>('/force-routes', body)
  return data
}

export async function deleteForceRoute(id: number): Promise<void> {
  await api.delete(`/force-routes/${id}`)
}

export async function toggleForceRoute(id: number, active: boolean): Promise<ForceRoute> {
  const { data } = await api.patch<ForceRoute>(`/force-routes/${id}`, { active })
  return data
}

export async function syncForceRoutes(regionId: number): Promise<SyncResult> {
  const { data } = await api.post<SyncResult>(`/force-routes/sync/${regionId}`)
  return data
}

export async function clearForceRoutes(regionId: number): Promise<SyncResult> {
  const { data } = await api.post<SyncResult>(`/force-routes/clear/${regionId}`)
  return data
}
