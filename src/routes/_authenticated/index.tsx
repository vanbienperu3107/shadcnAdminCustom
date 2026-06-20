import { createFileRoute, redirect } from '@tanstack/react-router'

// Trang chủ -> Overview (dashboard home). Bo dashboard demo cua template.
export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: () => {
    throw redirect({ to: '/overview' })
  },
})
