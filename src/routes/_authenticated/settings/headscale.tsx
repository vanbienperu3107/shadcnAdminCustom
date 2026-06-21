import { createFileRoute } from '@tanstack/react-router'
import { SettingsHeadscale } from '@/features/settings/headscale'

export const Route = createFileRoute('/_authenticated/settings/headscale')({
  component: SettingsHeadscale,
})
