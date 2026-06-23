import { createFileRoute } from '@tanstack/react-router'
import { HsRoutes } from '@/features/hs-routes'

export const Route = createFileRoute('/_authenticated/hs-routes/')({
  component: HsRoutes,
})
