import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Machines (tab Node Assignments) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/node-assignments/')({
  beforeLoad: () => {
    throw redirect({ to: '/machines' })
  },
})
