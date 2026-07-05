import { createFileRoute, redirect } from '@tanstack/react-router'
import { meQueryOptions } from '@/lib/auth-api'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  // Gác cổng: phải đăng nhập Google (backend /api/auth/me). 401 -> về /sign-in.
  // Dùng ensureQueryData để cache phiên: điều hướng trong staleTime (30s) lấy
  // từ cache, không gọi lại /auth/me mỗi lần click -> hết cảm giác load chậm.
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions)
    if (!me) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: AuthenticatedLayout,
})
