import { api } from '@/lib/api-client'
import { type DerpFormValues, type DerpServer } from './schema'

export const derpKeys = {
  all: ['derp'] as const,
  nextRegionId: ['derp', 'next-region-id'] as const,
}

export async function listDerp(): Promise<DerpServer[]> {
  const { data } = await api.get<DerpServer[]>('/derp')
  return data
}

export async function getNextRegionId(): Promise<number> {
  const { data } = await api.get<{ regionId: number }>('/derp/next-region-id')
  return data.regionId
}

/** Chuyển form (số dạng chuỗi) -> payload backend (số thật, ipv4 rỗng -> null). */
function toPayload(values: DerpFormValues) {
  return {
    name: values.name,
    code: values.code,
    nodeName: values.nodeName,
    hostname: values.hostname,
    ipv4: values.ipv4 ? values.ipv4 : null,
    derpPort: Number(values.derpPort),
    stunPort: Number(values.stunPort),
    canPort80: values.canPort80,
    priority: Number(values.priority),
  }
}

export async function createDerp(values: DerpFormValues): Promise<DerpServer> {
  const { data } = await api.post<DerpServer>('/derp', toPayload(values))
  return data
}

export async function updateDerp(
  regionId: number,
  values: DerpFormValues
): Promise<DerpServer> {
  const { data } = await api.patch<DerpServer>(
    `/derp/${regionId}`,
    toPayload(values)
  )
  return data
}

export async function deleteDerp(regionId: number): Promise<void> {
  await api.delete(`/derp/${regionId}`)
}

export async function toggleDerp(
  regionId: number,
  body: { enabled?: boolean; paused?: boolean }
): Promise<DerpServer> {
  const { data } = await api.post<DerpServer>(`/derp/${regionId}/toggle`, body)
  return data
}
