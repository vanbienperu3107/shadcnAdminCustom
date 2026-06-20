import { createFileRoute } from '@tanstack/react-router'
import { Latency } from '@/features/latency'

export const Route = createFileRoute('/_authenticated/latency/')({
  component: Latency,
})
