import { api } from '@/lib/api-client'

/** 1 dòng device_enrollment. `salt` = serial ổ đĩa đã chuẩn hoá — NHẠY CẢM:
 *  nó suy ra được private machine key, nên UI mask mặc định. */
export type Enrollment = {
  id: number
  mac: string
  salt: string
  status: 'pending' | 'approved' | 'revoked'
  /** đã có thiết bị claim device token chưa (first-enroll-wins) */
  claimed: boolean
  pinnedIpv4: string | null
  note: string | null
  hostname: string | null
  createdAt: string
  approvedAt: string | null
  approvedBy: string | null
  enrolledAt: string | null
  lastEnrollAt: string | null
}

export const enrollKeys = {
  list: ['enrollments'] as const,
}

export async function fetchEnrollments(): Promise<Enrollment[]> {
  const { data } = await api.get<Enrollment[]>('/enrollments')
  return data
}

export async function approveEnrollment(
  id: number,
  body: { pinnedIpv4?: string; note?: string }
): Promise<void> {
  await api.post(`/enrollments/${id}/approve`, body)
}

export async function revokeEnrollment(id: number): Promise<void> {
  await api.post(`/enrollments/${id}/revoke`, {})
}

/** Máy mất node.xml (mất device token) → xoá hash để nó claim lại được. */
export async function resetEnrollmentToken(id: number): Promise<void> {
  await api.post(`/enrollments/${id}/reset-token`, {})
}

export async function deleteEnrollment(id: number): Promise<void> {
  await api.delete(`/enrollments/${id}`)
}

/** Duyệt trước bằng (mac, salt) lấy từ `<exe> id`, trước khi cắm máy. */
export async function preApproveEnrollment(body: {
  mac: string
  salt: string
  note?: string
  pinnedIpv4?: string
}): Promise<void> {
  await api.post('/enrollments/pre-approve', body)
}

/** Che serial khi hiển thị — bản sao maskSalt() phía server. */
export function maskSalt(salt: string): string {
  if (salt.length <= 4) return '••••'
  return `${salt.slice(0, 2)}••••${salt.slice(-2)}`
}
