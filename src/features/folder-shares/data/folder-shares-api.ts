import { api } from '@/lib/api-client'

export const folderShareKeys = {
  all: ['folder-shares'] as const,
}

export type FolderAccess = {
  id: number
  shareId: number
  granteeMac: string
  granteeHostname: string | null
  access: 'ro' | 'rw'
  autoMount: boolean
  mountDrive: string | null
  enabled: boolean
  createdAt: string
}

export type FolderShare = {
  id: number
  ownerMac: string
  ownerHostname: string | null
  shareName: string
  localPath: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  access: FolderAccess[]
}

export type FolderShareInput = {
  ownerMac: string
  ownerHostname?: string | null
  shareName: string
  localPath: string
  enabled?: boolean
}

export type AccessInput = {
  granteeMac: string
  granteeHostname?: string | null
  access: 'ro' | 'rw'
  autoMount: boolean
  mountDrive?: string | null
  enabled: boolean
}

export async function listFolderShares(): Promise<FolderShare[]> {
  const { data } = await api.get<FolderShare[]>('/folder-shares')
  return data
}

export async function createFolderShare(
  body: FolderShareInput
): Promise<FolderShare> {
  const { data } = await api.post<FolderShare>('/folder-shares', body)
  return data
}

export async function updateFolderShare(
  id: number,
  body: Partial<FolderShareInput>
): Promise<FolderShare> {
  const { data } = await api.put<FolderShare>(`/folder-shares/${id}`, body)
  return data
}

export async function deleteFolderShare(id: number): Promise<void> {
  await api.delete(`/folder-shares/${id}`)
}

export async function setFolderAccess(
  id: number,
  access: AccessInput[]
): Promise<void> {
  await api.put(`/folder-shares/${id}/access`, { access })
}

// ---- Folder picker (duyệt cây thư mục của PC) ----
export type BrowseEntry = { name: string; is_dir: boolean }

export type BrowseResult = {
  pending: boolean
  reqPath?: string | null
  resPath: string | null
  entries: BrowseEntry[]
  resultAt?: string | null
}

export async function requestBrowse(mac: string, path: string): Promise<void> {
  await api.post('/folder-shares/browse', { mac, path })
}

export async function getBrowse(mac: string): Promise<BrowseResult> {
  const { data } = await api.get<BrowseResult>(
    `/folder-shares/browse/${encodeURIComponent(mac)}`
  )
  return data
}
