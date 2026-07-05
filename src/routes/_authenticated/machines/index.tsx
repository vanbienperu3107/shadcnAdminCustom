import { createFileRoute, redirect } from '@tanstack/react-router'

// /machines -> nhóm đầu tiên (Thiết bị). Sidebar mở Machines thành 5 nhóm con.
export const Route = createFileRoute('/_authenticated/machines/')({
  beforeLoad: () => {
    throw redirect({ to: '/machines/thiet-bi' })
  },
})
