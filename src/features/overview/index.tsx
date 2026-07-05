import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, Loader2, Network, Radio, Server, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
  deviceTypeMap,
  fetchDevices,
  fetchHsUsers,
  fetchLatency,
  fetchMachines,
  hsKeys,
  isDerpNodeV2,
  userName,
} from '@/features/headscale/hs-api'
import {
  homeDerpKeys,
  listHomeDerp,
} from '@/features/home-derp/data/home-derp-api'

type StatTo = '/overview' | '/machines' | '/tailnet-access'

type StatProps = {
  icon: typeof Server
  label: string
  value: ReactNode
  sub?: ReactNode
  to: StatTo
  /** Đang refetch nền (dữ liệu đã có) -> hiện chấm xoay nhỏ báo "đang cập nhật". */
  fetching?: boolean
}

function Stat({ icon: Icon, label, value, sub, to, fetching }: StatProps) {
  return (
    <Link to={to}>
      <Card className='transition-colors hover:bg-muted/40'>
        <CardContent className='relative flex items-center gap-3 p-5'>
          <Icon className='size-7 shrink-0 text-muted-foreground' />
          {fetching && (
            <Loader2
              className='absolute end-2 top-2 size-3 animate-spin text-muted-foreground'
              aria-label='Đang cập nhật'
            />
          )}
          <div className='ms-auto text-end'>
            <div className='text-xs text-muted-foreground'>{label}</div>
            <div className='text-3xl font-bold tracking-tight'>{value}</div>
            {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

/** Giá trị box khi đang tải LẦN ĐẦU: spinner rõ ràng để biết đang lấy dữ liệu. */
function StatLoading() {
  return (
    <span className='flex items-center justify-end gap-2 text-muted-foreground'>
      <Loader2 className='size-5 animate-spin' />
      <Skeleton className='h-7 w-8' />
    </span>
  )
}

function RelayBadge({ region }: { region: string }) {
  if (!region) return <span className='text-xs text-muted-foreground'>—</span>
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

// --- Query hooks dùng chung ---------------------------------------------------
// react-query gộp (dedupe) theo queryKey, nên nhiều box cùng đọc một key chỉ tốn
// 1 request. Mỗi key chỉ đặt refetchInterval ở ĐÚNG MỘT nơi (owner) để tránh
// nhiều timer polling chồng nhau; các nơi khác chỉ đọc cache + staleTime.

/** Tập node "thật" (loại bỏ node DERP) — cần machines + devices + derp. */
function useRealNodes({ poll = false }: { poll?: boolean } = {}) {
  const derp = useQuery({
    queryKey: derpKeys.all,
    queryFn: listDerp,
    staleTime: 30_000,
  })
  const machines = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    staleTime: 30_000,
    refetchInterval: poll ? 30_000 : undefined,
  })
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    staleTime: 30_000,
  })

  const names = derpNameSet(derp.data ?? [])
  const typeByNodeKey = deviceTypeMap(devices.data ?? [])
  const allNodes = machines.data?.nodes ?? []
  const realNodes = allNodes.filter(
    (n) => !isDerpNodeV2(n, typeByNodeKey, names)
  )

  return {
    derp,
    machines,
    devices,
    names,
    regions: derp.data ?? [],
    realNodes,
    realOnline: realNodes.filter((n) => n.online).length,
    hsOk: !!machines.data?.configured,
    isLoading: machines.isPending || devices.isPending || derp.isPending,
    isFetching: machines.isFetching || devices.isFetching || derp.isFetching,
  }
}

// --- Từng stat box (tự tải, tự skeleton) -------------------------------------

// Owner của polling machines (30s): luôn mounted nên chỉ 1 timer duy nhất.
function StatMachines() {
  const { realNodes, realOnline, hsOk, isLoading, isFetching } = useRealNodes({
    poll: true,
  })
  const color =
    hsOk && realNodes.length > 0
      ? realOnline === realNodes.length
        ? 'text-emerald-500 dark:text-emerald-400'
        : 'text-amber-500 dark:text-amber-400'
      : ''
  return (
    <Stat
      icon={Server}
      label='Machines'
      fetching={isFetching && !isLoading}
      value={
        isLoading ? (
          <StatLoading />
        ) : hsOk ? (
          <span className={color}>{realNodes.length}</span>
        ) : (
          '—'
        )
      }
      sub={
        isLoading
          ? undefined
          : hsOk
            ? `${realOnline} online · thiết bị thật`
            : 'cần API key'
      }
      to='/machines'
    />
  )
}

function StatUsers() {
  const users = useQuery({
    queryKey: hsKeys.users,
    queryFn: fetchHsUsers,
    staleTime: 30_000,
  })
  // hsOk lấy từ cache machines (đã fetch bởi StatMachines) — deduped.
  const machines = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    staleTime: 30_000,
  })
  const hsOk = !!machines.data?.configured
  const isLoading = users.isPending || machines.isPending
  return (
    <Stat
      icon={Users}
      label='Users'
      fetching={(users.isFetching || machines.isFetching) && !isLoading}
      value={
        isLoading ? (
          <StatLoading />
        ) : hsOk ? (
          <span className='text-sky-500 dark:text-sky-400'>
            {users.data?.users.length ?? 0}
          </span>
        ) : (
          '—'
        )
      }
      sub={isLoading ? undefined : hsOk ? 'tailnet users' : 'cần API key'}
      to='/tailnet-access'
    />
  )
}

function StatDerpRegions() {
  const derp = useQuery({
    queryKey: derpKeys.all,
    queryFn: listDerp,
    staleTime: 30_000,
  })
  const regions = derp.data ?? []
  const activeRegions = regions.filter((r) => r.enabled && !r.paused).length
  return (
    <Stat
      icon={Network}
      label='DERP regions'
      fetching={derp.isFetching && !derp.isPending}
      value={
        derp.isPending ? (
          <StatLoading />
        ) : (
          <span className='text-sky-500 dark:text-sky-400'>
            {regions.length}
          </span>
        )
      }
      sub={derp.isPending ? undefined : `${activeRegions} đang bật`}
      to='/machines'
    />
  )
}

function StatDerpHealth() {
  const health = useQuery({
    queryKey: derpKeys.health,
    queryFn: fetchHealth,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
  const healthUp = (health.data ?? []).filter((h) => h.up).length
  const healthDown = (health.data ?? []).filter((h) => !h.up).length
  const healthColor =
    healthDown === 0 && healthUp > 0
      ? 'text-emerald-500 dark:text-emerald-400'
      : healthDown > 0
        ? 'text-rose-500 dark:text-rose-400'
        : ''
  return (
    <Stat
      icon={Radio}
      label='DERP health'
      fetching={health.isFetching && !health.isPending}
      value={
        health.isPending ? (
          <StatLoading />
        ) : (
          <span className={healthColor}>
            {healthUp}/{healthUp + healthDown}
          </span>
        )
      }
      sub={
        health.isPending
          ? undefined
          : healthDown > 0
            ? `${healthDown} chết`
            : 'tất cả sống'
      }
      to='/machines'
    />
  )
}

function StatClientDerp() {
  const { realOnline, hsOk, isLoading, isFetching } = useRealNodes()
  return (
    <Stat
      icon={Activity}
      label='Client → DERP'
      fetching={isFetching && !isLoading}
      value={
        isLoading ? (
          <StatLoading />
        ) : hsOk ? (
          <span className='text-violet-500 dark:text-violet-400'>
            {realOnline}
          </span>
        ) : (
          '—'
        )
      }
      sub={isLoading ? undefined : 'xem định tuyến'}
      to='/machines'
    />
  )
}

// --- Bảng thiết bị người dùng (tự tải riêng, không chặn các stat) ------------

function ClientDevicesTable() {
  const { regions, names, realNodes, hsOk, isLoading, isFetching } =
    useRealNodes()
  // Owner của polling latency (30s) -> giữ dữ liệu gần thời gian thực.
  const lat = useQuery({
    queryKey: hsKeys.latency,
    queryFn: fetchLatency,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
  // NGUỒN CHÍNH XÁC của "DERP đang dùng": telemetry home-derp (client tự báo
  // homeRegionCode), GIỐNG tab Home DERP. Không suy từ heuristic latency pairs
  // nữa vì pairs có thể lấy nhầm relay của peer -> lệch với home DERP thật.
  const homeDerp = useQuery({
    queryKey: homeDerpKeys.all,
    queryFn: listHomeDerp,
    staleTime: 15_000,
    refetchInterval: 15_000,
  })
  const live = isFetching || lat.isFetching || homeDerp.isFetching

  // Chưa cấu hình headscale -> không hiện bảng (giống hành vi cũ).
  if (!isLoading && !hsOk) return null

  const regionCodes = new Set(
    regions.map((r) => r.code?.toLowerCase()).filter(Boolean)
  )
  const pairs = lat.data?.pairs ?? []
  const clientDerpMap = new Map<
    string,
    { region: string; rttMs: number | null; isHome: boolean }
  >()
  const lastReportAt = new Map<string, number>()
  for (const p of pairs) {
    const src = String(p.src ?? '')
      .toLowerCase()
      .trim()
    const dst = String(p.dst ?? '')
      .toLowerCase()
      .trim()
    const path = String(p.last_path ?? p.path ?? '')
    const rtt =
      typeof p.avg_ms === 'number'
        ? p.avg_ms
        : typeof p.rtt_ms === 'number'
          ? p.rtt_ms
          : null
    if (!src) continue
    const reportedAt = p.reported_at ? Date.parse(String(p.reported_at)) : NaN
    if (!Number.isNaN(reportedAt)) {
      const prev = lastReportAt.get(src)
      if (!prev || reportedAt > prev) lastReportAt.set(src, reportedAt)
    }
    const existing = clientDerpMap.get(src)
    if (path.startsWith('derp:')) {
      const isHome = regionCodes.has(dst)
      if (isHome || !existing || !existing.isHome) {
        clientDerpMap.set(src, {
          region: path.slice(5),
          rttMs: existing?.rttMs ?? null,
          isHome,
        })
      }
    }
    if (names.has(dst) && rtt !== null) {
      const info = clientDerpMap.get(src)
      if (info) {
        if (info.rttMs === null) info.rttMs = rtt
      } else {
        clientDerpMap.set(src, { region: '', rttMs: rtt, isHome: false })
      }
    }
  }

  // Map hostname/tên (lowercase) -> home DERP region code từ telemetry.
  const homeRegionByHost = new Map<string, string>()
  for (const r of homeDerp.data ?? []) {
    if (r.homeRegionCode && r.hostname) {
      homeRegionByHost.set(r.hostname.toLowerCase().trim(), r.homeRegionCode)
    }
  }
  // Node headscale có thể khớp theo givenName hoặc name (hostname gốc).
  const homeRegionOf = (n: (typeof realNodes)[number]): string =>
    homeRegionByHost.get((n.givenName || '').toLowerCase().trim()) ??
    homeRegionByHost.get((n.name || '').toLowerCase().trim()) ??
    ''

  // Chỉ hiện client đang online (yêu cầu: chỉ hiển thị client online).
  const clientRows = realNodes
    .filter((n) => n.online)
    .sort((a, b) =>
      (a.givenName || a.name || '').localeCompare(b.givenName || b.name || '')
    )

  return (
    <div className='flex flex-col gap-2'>
      <div>
        <h3 className='flex items-center gap-2 text-sm font-semibold'>
          Thiết bị người dùng online{' '}
          <span className='text-muted-foreground'>
            ({isLoading ? '…' : clientRows.length})
          </span>
          {live ? (
            <span className='flex items-center gap-1 text-xs font-normal text-muted-foreground'>
              <Loader2 className='size-3 animate-spin' /> đang cập nhật
            </span>
          ) : (
            <span className='flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400'>
              <span className='inline-block size-2 animate-pulse rounded-full bg-emerald-500' />{' '}
              live
            </span>
          )}
        </h3>
        <p className='text-xs text-muted-foreground'>
          Chỉ hiện thiết bị đang online · DERP &amp; latency cập nhật gần thời
          gian thực (mỗi 30s).
        </p>
      </div>
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên</TableHead>
              <TableHead className='hidden md:table-cell'>User</TableHead>
              <TableHead className='hidden lg:table-cell'>IP</TableHead>
              <TableHead>DERP đang dùng</TableHead>
              <TableHead className='hidden sm:table-cell'>
                Latency đến DERP
              </TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className='hidden lg:table-cell'>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell
                      key={j}
                      className={
                        j === 1 || j === 6
                          ? 'hidden md:table-cell'
                          : j === 2
                            ? 'hidden lg:table-cell'
                            : j === 4
                              ? 'hidden sm:table-cell'
                              : ''
                      }
                    >
                      <Skeleton className='h-4 w-full' />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : clientRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className='h-16 text-center text-muted-foreground'
                >
                  Không có thiết bị nào đang online.
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
                    <TableCell className='hidden text-xs text-muted-foreground md:table-cell'>
                      {userName(n.user)}
                    </TableCell>
                    <TableCell className='hidden font-mono text-xs lg:table-cell'>
                      {n.ipAddresses?.[0] ?? '—'}
                    </TableCell>
                    <TableCell>
                      {n.online ? (
                        <RelayBadge region={homeRegionOf(n)} />
                      ) : (
                        <span className='text-xs text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell className='hidden font-mono text-xs sm:table-cell'>
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
                    <TableCell className='hidden text-xs text-muted-foreground lg:table-cell'>
                      {(() => {
                        const hsSeen = n.lastSeen ? Date.parse(n.lastSeen) : NaN
                        const reportSeen = lastReportAt.get(
                          (n.givenName || n.name || '').toLowerCase()
                        )
                        const best = [hsSeen, reportSeen]
                          .filter((t) => !Number.isNaN(t) && t != null)
                          .sort((a, b) => (b as number) - (a as number))[0]
                        return best ? new Date(best).toLocaleString() : '—'
                      })()}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function Overview() {
  // Mỗi box/bảng bên dưới tự sở hữu query của nó và tự hiện skeleton khi tải,
  // nên trang xuất hiện ngay và từng phần fill dần khi dữ liệu về (không còn
  // chờ đồng bộ cả 6 query như trước).
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
        <StatMachines />
        <StatUsers />
        <StatDerpRegions />
        <StatDerpHealth />
        <StatClientDerp />
      </div>

      {/* Client devices table */}
      <ClientDevicesTable />
    </Main>
  )
}
