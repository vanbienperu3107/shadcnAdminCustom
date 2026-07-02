import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Tailnet Access (tab PAC Rules) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/pac-rules/')({
  beforeLoad: () => {
    throw redirect({ to: '/tailnet-access' })
  },
})
