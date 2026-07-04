import { create } from 'zustand'

interface AuthUser {
  accountNo: string
  email: string
  role: string[]
  exp: number
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    reset: () => void
  }
}

// Phiên đăng nhập THẬT là cookie httpOnly do backend quản lý (xem logout()/fetchMe()
// trong lib/auth-api). Store này chủ ý KHÔNG giữ access token phía client — tránh
// việc sau này ai đó gắn `Authorization: Bearer` từ đây và mở lại lỗ hổng bỏ qua auth.
export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),
    reset: () =>
      set((state) => ({ ...state, auth: { ...state.auth, user: null } })),
  },
}))
