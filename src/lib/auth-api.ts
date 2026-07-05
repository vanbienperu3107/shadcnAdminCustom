import { api, API_BASE } from '@/lib/api-client'

export type Me = {
  id: number
  email: string
  name: string | null
  picture: string | null
  username: string | null
  totpEnabled: boolean
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

/**
 * queryKey + option dùng chung cho phiên đăng nhập hiện tại.
 * Dùng qua queryClient.ensureQueryData trong beforeLoad để KHÔNG gọi lại
 * /auth/me (network + Postgres JOIN) mỗi lần điều hướng — chỉ refetch sau
 * khi hết staleTime. Đây là fix chính cho "click trang load chậm".
 */
export const meQueryKey = ['auth', 'me'] as const

export const meQueryOptions = {
  queryKey: meQueryKey,
  queryFn: fetchMe,
  // Trong cửa sổ này mọi navigation dùng lại cache, không đụng mạng.
  staleTime: 30_000,
  gcTime: 5 * 60_000,
} as const

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

export type LoginResult = { mfaRequired: boolean }

/** Bước 1 đăng nhập nội bộ: username + mật khẩu. */
export async function loginPassword(
  username: string,
  password: string
): Promise<LoginResult> {
  const { data } = await api.post<{ ok?: boolean; mfaRequired?: boolean }>(
    '/auth/login',
    { username, password }
  )
  return { mfaRequired: !!data.mfaRequired }
}

/** Bước 2: xác minh mã TOTP cho session đang pending. */
export async function verifyLogin2fa(code: string): Promise<void> {
  await api.post('/auth/login/verify-2fa', { code })
}

export type TotpSetup = { secret: string; otpauthUri: string }

/** Bắt đầu cài 2FA — trả secret + otpauth URI để quét QR / nhập tay. */
export async function setup2fa(): Promise<TotpSetup> {
  const { data } = await api.post<TotpSetup>('/auth/2fa/setup')
  return data
}

/** Bật 2FA sau khi nhập đúng mã từ secret vừa setup. */
export async function enable2fa(secret: string, code: string): Promise<void> {
  await api.post('/auth/2fa/enable', { secret, code })
}

/** Tắt 2FA (xác nhận bằng mật khẩu). */
export async function disable2fa(password: string): Promise<void> {
  await api.post('/auth/2fa/disable', { password })
}

/** Đổi mật khẩu (yêu cầu mật khẩu hiện tại). */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword })
}
