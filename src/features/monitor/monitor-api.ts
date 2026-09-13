import { api } from '@/lib/api-client'

export type MonitorSystem = {
  id: string
  name: string
  status: 'up' | 'down' | 'paused' | 'pending'
  cpu: number | null
  mem: number | null
  disk: number | null
  load: [number, number, number] | null
  netBps: number | null
  uptimeSec: number | null
  agent: string | null
  updated: string | null
}

export const STATUS_URL = 'https://status.hangocthanh.io.vn'

/** Trang chi tiết 1 máy trong Beszel: /system/<id record systems>. */
export function systemUrl(id: string): string {
  return `${STATUS_URL}/system/${encodeURIComponent(id)}`
}

export const monitorKeys = {
  systems: ['monitor', 'systems'] as const,
}

export async function fetchMonitorSystems(): Promise<MonitorSystem[]> {
  const { data } = await api.get<{ systems: MonitorSystem[] }>(
    '/monitor/systems'
  )
  return data.systems
}

/** Thanh %: dưới 70 xanh, 70–90 vàng, trên 90 đỏ. */
export function levelOf(pct: number): 'ok' | 'warn' | 'bad' {
  if (pct > 90) return 'bad'
  if (pct >= 70) return 'warn'
  return 'ok'
}

export function formatUptime(sec: number | null): string {
  if (sec == null) return '—'
  const h = Math.floor(sec / 3600)
  if (h < 48) return `${h} giờ`
  return `${Math.floor(h / 24)} ngày`
}

export function formatRate(bps: number | null): string {
  if (bps == null) return '—'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

export function minutesAgo(
  iso: string | null,
  now = Date.now()
): number | null {
  if (!iso) return null
  const t = Date.parse(iso.replace(' ', 'T'))
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 60_000))
}
