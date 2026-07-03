import { api } from '@/lib/api-client'

export const assignmentKeys = {
  all: ['node-assignments'] as const,
}

/** null = không khóa (exclusive=false). 'ok' = region khóa sống, phục vụ
 *  exclusive bình thường. 'grace' = chết nhưng <10' (vẫn exclusive, chờ hồi
 *  phục). 'fallback' = chết ≥10' liên tục → van an toàn, đang phục vụ map
 *  UNION như bình thường để không kẹt client. */
export type DerpLockStatus = 'ok' | 'grace' | 'fallback' | null

export type NodeAssignmentGroup = {
  nodeKey: string
  exclusive: boolean
  derpStatus: DerpLockStatus
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
  regionIds: number[],
  exclusive?: boolean
): Promise<{ nodeKey: string; regionIds: number[]; exclusive: boolean }> {
  const { data } = await api.put<{
    nodeKey: string
    regionIds: number[]
    exclusive: boolean
  }>(`/node-assignments/${encodeURIComponent(nodeKey)}`, {
    regionIds,
    exclusive,
  })
  return data
}

export async function deleteNodeAssignment(nodeKey: string): Promise<void> {
  await api.delete(`/node-assignments/${encodeURIComponent(nodeKey)}`)
}

/** "Reload" khóa DERP — xóa trạng thái sức khỏe đang lưu, ép đánh giá lại
 *  (≤30s, chu kỳ probe nền) và quay về exclusive ngay nếu region đã sống. */
export async function reloadDerpLock(nodeKey: string): Promise<void> {
  await api.post(`/node-assignments/${encodeURIComponent(nodeKey)}/reload-derp`)
}
