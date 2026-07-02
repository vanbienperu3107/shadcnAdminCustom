import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Tailnet Access (tab Node Runtime) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/node-runtime/')({
  beforeLoad: () => {
    throw redirect({ to: '/tailnet-access' })
  },
})
