import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'
import { Main } from '@/components/layout/main'
import { Acl } from '@/features/acl'
import { ClientConfig } from '@/features/client-config'
import { ClientAutoUpdateCard } from '@/features/client-update'
import { Derp } from '@/features/derp'
import { DerpPing } from '@/features/derp-ping'
import { DnsSplit } from '@/features/dns-split'
import { ForceRoutes } from '@/features/force-routes'
import { HomeDerp } from '@/features/home-derp'
import { HsRoutes } from '@/features/hs-routes'
import { Latency } from '@/features/latency'
import { DevicesTable } from '@/features/machines'
import { NodeAssignments } from '@/features/node-assignments'
import { NodeRuntimePage } from '@/features/node-runtime'
import { PacRulesPage } from '@/features/pac-rules'
import { PreAuthKeys } from '@/features/preauth-keys'
import { Users } from '@/features/users'

export type MachineGroup = 'devices' | 'routing' | 'derp' | 'config' | 'users'

type Leaf = { key: string; label: string; render: () => ReactNode }

// Nhóm (tầng 1 = sidebar) -> các mục lá (tầng 2 = navbar trong trang).
const GROUPS: Record<MachineGroup, Leaf[]> = {
  devices: [
    {
      key: 'users',
      label: 'Người dùng',
      render: () => <DevicesTable variant='users' />,
    },
    {
      key: 'infra',
      label: 'Hạ tầng DERP',
      render: () => <DevicesTable variant='derp' />,
    },
  ],
  routing: [
    { key: 'routes', label: 'Routes', render: () => <HsRoutes /> },
    { key: 'force', label: 'Force Routes', render: () => <ForceRoutes /> },
    {
      key: 'assign',
      label: 'Node Assignments',
      render: () => <NodeAssignments />,
    },
    { key: 'acl', label: 'ACL', render: () => <Acl /> },
  ],
  derp: [
    { key: 'regions', label: 'Regions', render: () => <Derp /> },
    { key: 'latency', label: 'Latency', render: () => <Latency /> },
    { key: 'home', label: 'Home DERP', render: () => <HomeDerp /> },
    { key: 'ping', label: 'Ping DERP', render: () => <DerpPing /> },
  ],
  config: [
    {
      key: 'runtime',
      label: 'Node runtime',
      render: () => <NodeRuntimePage />,
    },
    { key: 'pac', label: 'PAC Rule', render: () => <PacRulesPage /> },
    { key: 'client', label: 'Client config', render: () => <ClientConfig /> },
    { key: 'dns', label: 'Split DNS', render: () => <DnsSplit /> },
    {
      key: 'autoupdate',
      label: 'Auto-update',
      render: () => (
        <div className='max-w-2xl'>
          <ClientAutoUpdateCard />
        </div>
      ),
    },
  ],
  users: [
    { key: 'user', label: 'User', render: () => <Users /> },
    { key: 'preauth', label: 'Pre-auth Key', render: () => <PreAuthKeys /> },
  ],
}

/**
 * Trang cho MỘT nhóm Machines. Bố trí 2 tầng:
 *  - Tầng 1: chọn nhóm ở sidebar trái (mỗi nhóm là 1 route).
 *  - Tầng 2: navbar underline ngay đầu trang chọn mục lá (state cục bộ).
 * Không còn tiêu đề trang lớn để tiết kiệm không gian dọc.
 */
export function MachinesSection({ group }: { group: MachineGroup }) {
  const leaves = GROUPS[group]
  const [active, setActive] = useState(leaves[0].key)
  const current = leaves.find((l) => l.key === active) ?? leaves[0]

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      {/* Tầng 2: navbar mục lá — cuộn ngang gọn trên mobile */}
      <div
        role='tablist'
        aria-label='Mục con'
        className='-mb-1 flex flex-nowrap gap-1 overflow-x-auto border-b sm:flex-wrap'
      >
        {leaves.map((l) => {
          const on = l.key === active
          return (
            <button
              key={l.key}
              role='tab'
              type='button'
              aria-selected={on}
              onClick={() => setActive(l.key)}
              className={cn(
                'relative shrink-0 px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors',
                on
                  ? 'text-violet-600 dark:text-violet-400'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {l.label}
              {on && (
                <span className='absolute inset-x-2.5 -bottom-px h-0.5 rounded bg-violet-600 dark:bg-violet-400' />
              )}
            </button>
          )
        })}
      </div>

      <div>{current.render()}</div>
    </Main>
  )
}
