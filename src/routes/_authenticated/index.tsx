import { createFileRoute, redirect } from '@tanstack/react-router'

// Trang chủ -> DERP Regions (tinh nang chinh). Bo dashboard demo cua template.
export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: () => {
    throw redirect({ to: '/derp' })
  },
})
