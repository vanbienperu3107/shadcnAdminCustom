import { createFileRoute } from '@tanstack/react-router'
import { TailnetUsers } from '@/features/tailnet-users'

export const Route = createFileRoute('/_authenticated/tailnet-users/')({
  component: TailnetUsers,
})
