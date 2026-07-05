import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Machines (tab Force Routes) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/force-routes/')({
  beforeLoad: () => {
    throw redirect({ to: '/machines/dinh-tuyen' })
  },
})
