import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, Network, Radio, Server, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { derpKeys, fetchHealth, listDerp } from '@/features/derp/data/derp-api'
import {
  derpNameSet,
  fetchHsUsers,
  fetchMachines,
  hsKeys,
  isDerpNode,
} from '@/features/headscale/hs-api'

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: typeof Server
  label: string
  value: ReactNode
  sub?: string
  to: '/overview' | '/machines' | '/tailnet-users' | '/latency' | '/derp'
}) {
  return (
    <Link to={to}>
      <Card className='transition-colors hover:bg-muted/40'>
        <CardContent className='flex items-center gap-4 p-5'>
          <Icon className='size-8 text-muted-foreground' />
          <div className='ms-auto text-end'>
            <div className='text-sm text-muted-foreground'>{label}</div>
            <div className='text-3xl font-bold tracking-tight'>{value}</div>
            {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function Overview() {
  const derp = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })
  const health = useQuery({
    queryKey: derpKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  })
  const machines = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })
  const users = useQuery({ queryKey: hsKeys.users, queryFn: fetchHsUsers })

  const regions = derp.data ?? []
  const activeRegions = regions.filter((r) => r.enabled && !r.paused).length
  const healthUp = (health.data ?? []).filter((h) => h.up).length
  const healthDown = (health.data ?? []).filter((h) => !h.up).length

  // CHỈ đếm thiết bị THẬT — loại node hạ tầng DERP (vpn*, collector).
  const names = derpNameSet(regions)
  const realNodes = (machines.data?.nodes ?? []).filter(
    (n) => !isDerpNode(n.givenName || n.name, names)
  )
  const realOnline = realNodes.filter((n) => n.online).length
  const hsOk = machines.data?.configured

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Overview</h2>
        <p className='text-muted-foreground'>
          Tổng quan Headscale tailnet &amp; DERP. Tự làm mới 30s.
        </p>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        <Stat
          icon={Server}
          label='Machines'
          value={hsOk ? realNodes.length : '—'}
          sub={
            hsOk ? `${realOnline} online · chỉ thiết bị thật` : 'cần API key'
          }
          to='/machines'
        />
        <Stat
          icon={Users}
          label='Users'
          value={hsOk ? (users.data?.users.length ?? 0) : '—'}
          sub={hsOk ? 'tailnet users' : 'cần API key'}
          to='/tailnet-users'
        />
        <Stat
          icon={Network}
          label='DERP regions'
          value={regions.length}
          sub={`${activeRegions} đang bật`}
          to='/derp'
        />
        <Stat
          icon={Radio}
          label='DERP health'
          value={`${healthUp}/${healthUp + healthDown}`}
          sub={healthDown > 0 ? `${healthDown} chết` : 'tất cả sống'}
          to='/derp'
        />
        <Stat
          icon={Activity}
          label='Client → DERP'
          value={hsOk ? realOnline : '—'}
          sub='xem định tuyến'
          to='/latency'
        />
      </div>
    </Main>
  )
}
