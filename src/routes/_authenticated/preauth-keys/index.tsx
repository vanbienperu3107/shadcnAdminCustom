import { createFileRoute } from '@tanstack/react-router'
import { PreAuthKeys } from '@/features/preauth-keys'

export const Route = createFileRoute('/_authenticated/preauth-keys/')({
  component: PreAuthKeys,
})
