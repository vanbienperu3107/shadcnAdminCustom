import { createFileRoute } from '@tanstack/react-router'
import { NodeAssignments } from '@/features/node-assignments'

export const Route = createFileRoute('/_authenticated/node-assignments/')({
  component: NodeAssignments,
})
