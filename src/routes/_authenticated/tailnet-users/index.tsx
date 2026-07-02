import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Tailnet Access (tab Users) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/tailnet-users/')({
  beforeLoad: () => {
    throw redirect({ to: '/tailnet-access' })
  },
})
