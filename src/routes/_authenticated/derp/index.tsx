import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Machines (tab Regions) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/derp/')({
  beforeLoad: () => {
    throw redirect({ to: '/machines' })
  },
})
