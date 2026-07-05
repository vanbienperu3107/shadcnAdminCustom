import { createFileRoute } from '@tanstack/react-router'
import { MachinesSection } from '@/features/machines/machines-section'

export const Route = createFileRoute('/_authenticated/machines/dinh-tuyen')({
  component: () => <MachinesSection group='routing' />,
})
