import { createFileRoute } from '@tanstack/react-router'
import { NodeRuntimePage } from '@/features/node-runtime'

export const Route = createFileRoute('/_authenticated/node-runtime/')({
  component: NodeRuntimePage,
})
