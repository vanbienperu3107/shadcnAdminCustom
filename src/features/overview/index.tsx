import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, Network, Radio, Server, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { derpKeys, fetchHealth, listDerp } from '@/features/derp/data/derp-api'
import {
  derpNameSet,
  fetchHsUsers,
  fetchLatency,
  fetchMachines,
  hsKeys,
  isDerpNode,
  userName,
} from '@/features/headscale/hs-api'

type StatProps = {
  icon: typeof Server
  label: string
  value: ReactNode
  sub?: string
  to: '/overview' | '/machines' | '/tailnet-users' | '/latency' | '/derp'
}

function Stat({ icon: Icon, label, value, sub, to }: StatProps) {
  return (
    <Link to={to}>
      <Card className='transition-colors hover:bg-muted/40'>
        <CardContent className='flex items-center gap-3 p-5'>
          <Icon className='size-7 shrink-0 text-muted-foreground' />
          <div className='ms-auto text-end'>
            <div className='text-xs text-muted-foreground'>{label}</div>
            <div className='text-3xl font-bold tracking-tight'>{value}</div>
            {sub && (
              <div className='text-xs text-muted-foreground'>{sub}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function RelayBadge({ region }: { region: string }) {
  if (!region)
    return <span className='text-xs text-muted-foreground'>—</span>
  if (region === 'direct')
    return (
      <Badge
        variant='outline'
        className='border-emerald-500/40 text-xs text-emerald-600 dark:text-emerald-400'
      >
        P2P
      </Badge>
    )
  return (
    <Badge
      variant='outline'
      className='border-violet-500/40 text-xs text-violet-600 dark:text-violet-400'
    >
      {region}
    </Badge>
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
  const lat = useQuery({
    queryKey: hsKeys.latency,
    queryFn: fetchLatency,
    refetchInterval: 30_000,
  })

  const regions = derp.data ?? []
  const activeRegions = regions.filter((r) => r.enabled && !r.paused).length
  const healthUp = (health.data ?? []).filter((h) => h.up).length
  const healthDown = (health.data ?? []).filter((h) => !h.up).length

  const names = derpNameSet(regions)
  const allNodes = machines.data?.nodes ?? []
  const realNodes = allNodes.filter(
    (n) => !isDerpNode(n.givenName || n.name, names)
  )
  const realOnline = realNodes.filter((n) => n.online).length
  const hsOk = !!machines.data?.configured

  // Stat value colors
  const machineColor =
    hsOk && realNodes.length > 0
      ? realOnline === realNodes.length
        ? 'text-emerald-500 dark:text-emerald-400'
        : 'text-amber-500 dark:text-amber-400'
      : ''

  const healthColor =
    healthDown === 0 && healthUp > 0
      ? 'text-emerald-500 dark:text-emerald-400'
      : healthDown > 0
        ? 'text-rose-500 dark:text-rose-400'
        : ''

  // Build per-client DERP info from latency pairs.
  // pairs shape: { src, dst, last_path, avg_ms } — src populated after Feature L migration.
  // Until then columns show "—" gracefully.
  const pairs = lat.data?.pairs ?? []
  const clientDerpMap = new Map<string, { region: string; rttMs: number | null }>()
  for (const p of pairs) {
    const src = String(p.src ?? '').toLowerCase().trim()
    const dst = String(p.dst ?? '').toLowerCase().trim()
    const path = String(p.last_path ?? p.path ?? '')
    const rtt =
      typeof p.avg_ms === 'number'
        ? p.avg_ms
        : typeof p.rtt_ms === 'number'
          ? p.rtt_ms
          : null
    if (!src) continue
    // Capture home DERP region from outgoing relay path
    if (path.startsWith('derp:') && !clientDerpMap.has(src)) {
      clientDerpMap.set(src, { region: path.slice(5), rttMs: null })
    }
    // Capture RTT to DERP server when dst is a DERP node
    if (names.has(dst) && rtt !== null) {
      const info = clientDerpMap.get(src)
      if (info) {
        if (info.rttMs === null) info.rttMs = rtt
      } else {
        clientDerpMap.set(src, { region: '', rttMs: rtt })
      }
    }
  }

  const clientRows = realNodes
    .slice()
    .sort((a, b) => Number(b.online) - Number(a.online))

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Overview</h2>
        <p className='text-muted-foreground'>
          Tổng quan Headscale tailnet &amp; DERP. Tự làm mới 30s.
        </p>
      </div>

      {/* Stats */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        <Stat
          icon={Server}
          label='Machines'
          value={
            hsOk ? (
              <span className={machineColor}>{realNodes.length}</span>
            ) : (
              '—'
            )
          }
          sub={hsOk ? `${realOnline} online · thiết bị thật` : 'cần API key'}
          to='/machines'
        />
        <Stat
          icon={Users}
          label='Users'
          value={
            hsOk ? (
              <span className='text-sky-500 dark:text-sky-400'>
                {users.data?.users.length ?? 0}
              </span>
            ) : (
              '—'
            )
          }
          sub={hsOk ? 'tailnet users' : 'cần API key'}
          to='/tailnet-users'
        />
        <Stat
          icon={Network}
          label='DERP regions'
          value={
            <span className='text-sky-500 dark:text-sky-400'>
              {regions.length}
            </span>
          }
          sub={`${activeRegions} đang bật`}
          to='/derp'
        />
        <Stat
          icon={Radio}
          label='DERP health'
          value={
            <span className={healthColor}>
              {healthUp}/{healthUp + healthDown}
            </span>
          }
          sub={healthDown > 0 ? `${healthDown} chết` : 'tất cả sống'}
          to='/derp'
        />
        <Stat
          icon={Activity}
          label='Client → DERP'
          value={
            hsOk ? (
              <span className='text-violet-500 dark:text-violet-400'>
                {realOnline}
              </span>
            ) : (
              '—'
            )
          }
          sub='xem định tuyến'
          to='/latency'
        />
      </div>

      {/* Client devices table */}
      {hsOk && (
        <div className='flex flex-col gap-2'>
          <div>
            <h3 className='text-sm font-semibold'>
              Thiết bị người dùng{' '}
              <span className='text-muted-foreground'>
                ({realNodes.length})
              </span>
            </h3>
            <p className='text-xs text-muted-foreground'>
              DERP đang dùng &amp; latency cập nhật từ client mỗi 60s.
            </p>
          </div>
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>DERP đang dùng</TableHead>
                  <TableHead>Latency đến DERP</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className='h-16 text-center text-muted-foreground'
                    >
                      Không có thiết bị nào.
                    </TableCell>
                  </TableRow>
                ) : (
                  clientRows.map((n, i) => {
                    const key = (n.givenName || n.name || '').toLowerCase()
                    const info = clientDerpMap.get(key)
                    return (
                      <TableRow
                        key={n.id ?? i}
                        className={n.online ? '' : 'opacity-50'}
                      >
                        <TableCell className='font-medium'>
                          {n.givenName || n.name || '—'}
                        </TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          {userName(n.user)}
                        </TableCell>
                        <TableCell className='font-mono text-xs'>
                          {n.ipAddresses?.[0] ?? '—'}
                        </TableCell>
                        <TableCell>
                          {n.online ? (
                            <RelayBadge region={info?.region ?? ''} />
                          ) : (
                            <span className='text-xs text-muted-foreground'>
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className='font-mono text-xs'>
                          {n.online && info?.rttMs != null ? (
                            `${Math.round(info.rttMs * 10) / 10}ms`
                          ) : (
                            <span className='text-muted-foreground'>—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {n.online ? (
                            <Badge
                              variant='outline'
                              className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                            >
                              <span className='me-1 inline-block size-2 rounded-full bg-emerald-500' />
                              Connected
                            </Badge>
                          ) : (
                            <Badge
                              variant='outline'
                              className='border-muted-foreground/30 text-muted-foreground'
                            >
                              <span className='me-1 inline-block size-2 rounded-full bg-muted-foreground' />
                              offline
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          {n.lastSeen
                            ? new Date(n.lastSeen).toLocaleString()
                            : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Main>
  )
}
