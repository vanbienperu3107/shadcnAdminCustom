import { createFileRoute } from '@tanstack/react-router'
import { Acl } from '@/features/acl'

export const Route = createFileRoute('/_authenticated/acl/')({
  component: Acl,
})
