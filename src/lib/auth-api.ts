import { api, API_BASE } from '@/lib/api-client'

export type Me = {
  id: number
  email: string
  name: string | null
  picture: string | null
}

/** Lấy user hiện tại; null nếu chưa đăng nhập (401). */
export async function fetchMe(): Promise<Me | null> {
  try {
    const { data } = await api.get<Me>('/auth/me')
    return data
  } catch {
    return null
  }
}

/** URL bắt đầu đăng nhập Google (full reload sang backend). */
export function googleLoginUrl(): string {
  return `${API_BASE}/auth/google/login`
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout')
  } catch {
    /* ignore */
  }
}
