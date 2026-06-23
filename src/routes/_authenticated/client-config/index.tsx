import { createFileRoute } from '@tanstack/react-router'
import { ClientConfig } from '@/features/client-config'

export const Route = createFileRoute('/_authenticated/client-config/')({
  component: ClientConfig,
})
