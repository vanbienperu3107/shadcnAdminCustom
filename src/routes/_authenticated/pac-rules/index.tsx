import { createFileRoute } from '@tanstack/react-router'
import { PacRulesPage } from '@/features/pac-rules'

export const Route = createFileRoute('/_authenticated/pac-rules/')({
  component: PacRulesPage,
})
