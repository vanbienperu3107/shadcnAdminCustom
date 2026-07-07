import type { FolderShareStatus } from './data/folder-shares-api'

/** Trạng thái owner serve 1 share (tra theo shareName trong report của owner).
 *  null = owner chưa báo gì (chưa poll / bản cũ). Thuần → unit-test được. */
export function ownerServeStatus(
  st: FolderShareStatus | undefined,
  shareName: string
): { ok: boolean; error?: string | null } | null {
  if (!st) return null
  const it = st.shares.find((x) => x.name === shareName)
  return it ? { ok: it.ok, error: it.error ?? null } : null
}

/** Trạng thái grantee mount 1 share (tra theo shareName trong report grantee). */
export function granteeMountStatus(
  st: FolderShareStatus | undefined,
  shareName: string
): { ok: boolean; error?: string | null } | null {
  if (!st) return null
  const it = st.mounts.find((x) => x.share === shareName)
  return it ? { ok: it.ok, error: it.error ?? null } : null
}
