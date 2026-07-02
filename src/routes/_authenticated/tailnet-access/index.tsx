import { createFileRoute } from '@tanstack/react-router'
import { TailnetAccess } from '@/features/tailnet-access'

export const Route = createFileRoute('/_authenticated/tailnet-access/')({
  component: TailnetAccess,
})
