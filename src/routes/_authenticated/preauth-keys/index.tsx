import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Tailnet Access (tab Pre-auth Keys) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/preauth-keys/')({
  beforeLoad: () => {
    throw redirect({ to: '/tailnet-access' })
  },
})
