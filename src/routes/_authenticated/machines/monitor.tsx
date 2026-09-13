import { createFileRoute } from '@tanstack/react-router'
import { MonitorPage } from '@/features/monitor'

export const Route = createFileRoute('/_authenticated/machines/monitor')({
  component: MonitorPage,
})
