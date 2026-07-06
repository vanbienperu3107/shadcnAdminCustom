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
  // null = theo cấu hình auto-update toàn cục; true/false = ép riêng máy này.
  autoUpdateEnabled: boolean | null
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
  autoUpdateEnabled?: boolean | null
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

/** Yêu cầu client tự áp lại cấu hình ngay — node poll thấy dấu thời gian mới
 *  hơn lần áp dụng gần nhất thì tự apply, không cần khởi động lại. */
export async function reloadNodeRuntime(mac: string): Promise<void> {
  await api.post(`/node-runtime/${encodeURIComponent(mac)}/reload`)
}

export type OnlineDevice = {
  hostname: string
  mac: string
  lastSeen: string
  configured: boolean
}

/** Thiết bị đang online (report metrics trong 5 phút gần nhất) — dùng để chọn
 *  thay vì gõ tay MAC. `configured=true` = đã có dòng node_runtime_config. */
export async function listOnlineDevices(): Promise<OnlineDevice[]> {
  const { data } = await api.get<
    { hostname: string; mac: string; last_seen: string; configured: boolean }[]
  >('/node-runtime/online')
  return data.map((d) => ({
    hostname: d.hostname,
    mac: d.mac,
    lastSeen: d.last_seen,
    configured: d.configured,
  }))
}
