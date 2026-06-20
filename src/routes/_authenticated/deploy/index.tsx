import { createFileRoute } from '@tanstack/react-router'
import { CiDeploy } from '@/features/ci-deploy'

export const Route = createFileRoute('/_authenticated/deploy/')({
  component: CiDeploy,
})
