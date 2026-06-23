import { api } from '@/lib/api-client'

export const assignmentKeys = {
  all: ['node-assignments'] as const,
}

export type NodeAssignmentGroup = {
  nodeKey: string
  regions: {
    regionId: number
    code: string
    name: string
    hostname: string
  }[]
}

export async function listNodeAssignments(): Promise<NodeAssignmentGroup[]> {
  const { data } = await api.get<NodeAssignmentGroup[]>('/node-assignments')
  return data
}

export async function setNodeAssignment(
  nodeKey: string,
  regionIds: number[]
): Promise<{ nodeKey: string; regionIds: number[] }> {
  const { data } = await api.put<{ nodeKey: string; regionIds: number[] }>(
    `/node-assignments/${encodeURIComponent(nodeKey)}`,
    { regionIds }
  )
  return data
}

export async function deleteNodeAssignment(nodeKey: string): Promise<void> {
  await api.delete(`/node-assignments/${encodeURIComponent(nodeKey)}`)
}
