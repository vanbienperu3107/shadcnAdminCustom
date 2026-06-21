import { createFileRoute } from '@tanstack/react-router'
import { ForceRoutes } from '@/features/force-routes'

export const Route = createFileRoute('/_authenticated/force-routes/')({
  component: ForceRoutes,
})
