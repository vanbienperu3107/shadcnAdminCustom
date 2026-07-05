import { createFileRoute, redirect } from '@tanstack/react-router'

// Gộp vào Machines (tab Routes) — 2026-07. Giữ redirect cho link/bookmark cũ.
export const Route = createFileRoute('/_authenticated/hs-routes/')({
  beforeLoad: () => {
    throw redirect({ to: '/machines/dinh-tuyen' })
  },
})
