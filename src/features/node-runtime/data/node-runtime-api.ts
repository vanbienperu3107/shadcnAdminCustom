import { api } from '@/lib/api-client'

export const nodeRuntimeKeys = {
  all: ['node-runtime'] as const,
}

export type NodeRuntime = {
  mac: string
  hostname: string | null
  mode: string | null
  loginServer: string | null
  alwaysUseDerp: boolean | null
  derpKeepaliveSecs: number | null
  peerHttpProxy: string | null
  socksAddr: string | null
  advertiseRoutes: string | null
  lanRoutes: string | null
  pacServerPort: number | null
  updatedAt: string
}

export type NodeRuntimeInput = {
  hostname?: string | null
  mode?: string | null
  loginServer?: string | null
  alwaysUseDerp?: boolean | null
  derpKeepaliveSecs?: number | null
  peerHttpProxy?: string | null
  socksAddr?: string | null
  advertiseRoutes?: string | null
  lanRoutes?: string | null
  pacServerPort?: number | null
}

export async function listNodeRuntime(): Promise<NodeRuntime[]> {
  const { data } = await api.get<NodeRuntime[]>('/node-runtime')
  return data
}

export async function upsertNodeRuntime(
  mac: string,
  body: NodeRuntimeInput
): Promise<NodeRuntime> {
  const { data } = await api.put<NodeRuntime>(
    `/node-runtime/${encodeURIComponent(mac)}`,
    body
  )
  return data
}

export async function deleteNodeRuntime(mac: string): Promise<void> {
  await api.delete(`/node-runtime/${encodeURIComponent(mac)}`)
}
