import { createFileRoute } from '@tanstack/react-router'
import { Derp } from '@/features/derp'

export const Route = createFileRoute('/_authenticated/derp/')({
  component: Derp,
})
