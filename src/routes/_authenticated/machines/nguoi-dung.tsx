import { createFileRoute } from '@tanstack/react-router'
import { MachinesSection } from '@/features/machines/machines-section'

export const Route = createFileRoute('/_authenticated/machines/nguoi-dung')({
  component: () => <MachinesSection group='users' />,
})
