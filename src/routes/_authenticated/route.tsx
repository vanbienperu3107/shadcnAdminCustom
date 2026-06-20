import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchMe } from '@/lib/auth-api'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  // Gác cổng: phải đăng nhập Google (backend /api/auth/me). 401 -> về /sign-in.
  beforeLoad: async ({ location }) => {
    const me = await fetchMe()
    if (!me) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: AuthenticatedLayout,
})
