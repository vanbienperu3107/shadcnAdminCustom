import axios from 'axios'

// Client riêng cho hub syncthingMem0 (REST của Syncthing + endpoint /api/*).
// KHÁC với `@/lib/api-client` (backend DERP). Dev: Vite proxy `/hub` -> :8384.
// Prod: đặt VITE_HUB_BASE_URL trỏ tới hub.
const HUB_API_KEY_STORAGE = 'hubApiKey'

export function getHubApiKey(): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(HUB_API_KEY_STORAGE) ?? ''
}

export function setHubApiKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  if (key) localStorage.setItem(HUB_API_KEY_STORAGE, key)
  else localStorage.removeItem(HUB_API_KEY_STORAGE)
}

export const hubApi = axios.create({
  baseURL: import.meta.env.VITE_HUB_BASE_URL ?? '/hub',
  timeout: 15000,
})

// Gắn X-API-Key (nếu đã cấu hình) cho các endpoint /rest/* cần xác thực.
hubApi.interceptors.request.use((config) => {
  const key = getHubApiKey()
  if (key) config.headers.set('X-API-Key', key)
  return config
})

export type HubHealth = { status: string }

export type HubConnectionService = {
  error: string | null
  lanAddresses: string[]
  wanAddresses: string[]
}

export type HubStatus = {
  myID: string
  uptime: number
  discoveryEnabled: boolean
  connectionServiceStatus: Record<string, HubConnectionService>
}

export type HubVersion = {
  version: string
  os: string
  arch: string
}

export type HubDevice = {
  deviceID: string
  name: string
  addresses: string[]
}

export type RegisterResult = {
  device_id: string
  token: string
}

export const hubKeys = {
  health: ['hub', 'health'] as const,
  status: ['hub', 'status'] as const,
  version: ['hub', 'version'] as const,
  devices: ['hub', 'devices'] as const,
}

export async function getHubHealth(): Promise<HubHealth> {
  const res = await hubApi.get<HubHealth>('/rest/noauth/health')
  return res.data
}

export async function getHubStatus(): Promise<HubStatus> {
  const res = await hubApi.get<HubStatus>('/rest/system/status')
  return res.data
}

export async function getHubVersion(): Promise<HubVersion> {
  const res = await hubApi.get<HubVersion>('/rest/system/version')
  return res.data
}

export async function listHubDevices(): Promise<HubDevice[]> {
  const res = await hubApi.get<HubDevice[]>('/rest/config/devices')
  return res.data
}

// Thu hồi thiết bị: xóa khỏi config hub -> token bearer của nó bị vô hiệu ngay.
export async function deleteHubDevice(deviceID: string): Promise<void> {
  await hubApi.delete(`/rest/config/devices/${deviceID}`)
}

// Đăng ký thiết bị mới. Hub fail-closed: phải có registrationSecret đúng,
// nếu không hub trả 403.
export async function registerHubDevice(
  deviceName: string,
  registrationSecret: string
): Promise<RegisterResult> {
  const res = await hubApi.post<RegisterResult>(
    '/api/register',
    { device_name: deviceName },
    registrationSecret
      ? { headers: { 'X-Registration-Secret': registrationSecret } }
      : undefined
  )
  return res.data
}
