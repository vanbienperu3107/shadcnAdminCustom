import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Tailnet Access (tab Client Config) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/client-config/')({
  beforeLoad: () => {
    throw redirect({ to: '/tailnet-access' })
  },
})
