import { createFileRoute } from '@tanstack/react-router'
import { HubAdmin } from '@/features/hub'

export const Route = createFileRoute('/_authenticated/hub/')({
  component: HubAdmin,
})
