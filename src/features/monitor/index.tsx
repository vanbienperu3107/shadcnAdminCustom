import { useQuery } from '@tanstack/react-query'
import { Cpu, ExternalLink, HardDrive, Loader2, MemoryStick, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  type MonitorSystem,
  fetchMonitorSystems,
  formatRate,
  formatUptime,
  levelOf,
  minutesAgo,
  monitorKeys,
} from './monitor-api'

const STATUS_URL = 'https://status.hangocthanh.io.vn'

const BAR_COLOR = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
} as const

function Meter({ value }: { value: number | null }) {
  return (
    <span className='flex items-center gap-2.5 font-mono text-[13px] tabular-nums'>
      <span className='w-12 text-end'>{value == null ? '—' : `${value.toFixed(1)}%`}</span>
      <span className='h-1.5 w-20 overflow-hidden rounded-full bg-muted'>
        {value != null && (
          <span
            className={cn('block h-full rounded-full', BAR_COLOR[levelOf(value)])}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        )}
      </span>
    </span>
  )
}

function StatusPill({ status }: { status: MonitorSystem['status'] }) {
  if (status === 'up')
    return (
      <Badge className='border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'>
        Online
      </Badge>
    )
  if (status === 'down')
    return (
      <Badge className='border-transparent bg-red-500/12 text-red-600 dark:text-red-400'>
        Mất kết nối
      </Badge>
    )
  return (
    <Badge variant='outline' className='text-muted-foreground'>
      {status === 'paused' ? 'Tạm dừng' : 'Đang chờ'}
    </Badge>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Server
  label: string
  value: string
  sub: string
  color: string
}) {
  return (
    <Card>
      <CardContent className='flex items-center gap-3 p-5'>
        <Icon className='size-7 shrink-0 text-muted-foreground' />
        <div className='ms-auto text-end'>
          <div className='text-xs text-muted-foreground'>{label}</div>
          <div className={cn('text-3xl font-bold tracking-tight tabular-nums', color)}>{value}</div>
          <div className='text-xs text-muted-foreground'>{sub}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function maxBy(list: MonitorSystem[], key: 'cpu' | 'mem' | 'disk') {
  return list.reduce<MonitorSystem | null>(
    (best, s) => (s[key] != null && (best == null || s[key]! > best[key]!) ? s : best),
    null
  )
}

function Stats({ systems }: { systems: MonitorSystem[] }) {
  // Chỉ tính máy online: số của máy mất kết nối là giá trị cũ.
  const up = systems.filter((s) => s.status === 'up')
  const down = systems.filter((s) => s.status === 'down').length
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)
  const cpuMax = maxBy(up, 'cpu')
  const memMax = maxBy(up, 'mem')
  const diskMax = maxBy(up, 'disk')
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      <Stat
        icon={Server}
        label='Máy chủ'
        value={`${up.length}/${systems.length}`}
        sub={down ? `online · ${down} mất kết nối` : 'tất cả online'}
        color='text-orange-500'
      />
      <Stat
        icon={Cpu}
        label='CPU trung bình'
        value={pct(avg(up.flatMap((s) => (s.cpu == null ? [] : [s.cpu]))))}
        sub={cpuMax ? `cao nhất ${cpuMax.name} ${pct(cpuMax.cpu)}` : '—'}
        color='text-sky-500'
      />
      <Stat
        icon={MemoryStick}
        label='RAM trung bình'
        value={pct(avg(up.flatMap((s) => (s.mem == null ? [] : [s.mem]))))}
        sub={memMax ? `cao nhất ${memMax.name} ${pct(memMax.mem)}` : '—'}
        color='text-emerald-500'
      />
      <Stat
        icon={HardDrive}
        label='Disk đầy nhất'
        value={pct(diskMax?.disk ?? null)}
        sub={diskMax?.name ?? '—'}
        color='text-violet-500'
      />
    </div>
  )
}

function SystemsTable({ systems }: { systems: MonitorSystem[] }) {
  return (
    <div className='overflow-x-auto rounded-xl border'>
      <Table className='min-w-[880px]'>
        <TableHeader>
          <TableRow>
            <TableHead>Tên</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>RAM</TableHead>
            <TableHead>Disk</TableHead>
            <TableHead>Load avg (1·5·15 phút)</TableHead>
            <TableHead>Mạng</TableHead>
            <TableHead>Uptime</TableHead>
            <TableHead>Agent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {systems.map((s) => {
            const stale = s.status !== 'up'
            const ago = minutesAgo(s.updated)
            return (
              <TableRow
                key={s.id}
                className='cursor-pointer'
                onClick={() => window.open(STATUS_URL, '_blank', 'noopener')}
              >
                <TableCell className='font-semibold'>{s.name}</TableCell>
                <TableCell>
                  <StatusPill status={s.status} />
                </TableCell>
                <TableCell className={cn(stale && 'opacity-55')}>
                  <Meter value={stale ? null : s.cpu} />
                </TableCell>
                <TableCell className={cn(stale && 'opacity-55')}>
                  <Meter value={s.mem} />
                </TableCell>
                <TableCell className={cn(stale && 'opacity-55')}>
                  <Meter value={s.disk} />
                </TableCell>
                <TableCell className={cn('font-mono text-[13px] tabular-nums', stale && 'opacity-55')}>
                  {!stale && s.load ? s.load.map((x) => x.toFixed(2)).join(' · ') : '—'}
                </TableCell>
                <TableCell className={cn('font-mono text-[13px] tabular-nums', stale && 'opacity-55')}>
                  {stale ? '—' : formatRate(s.netBps)}
                </TableCell>
                <TableCell className={cn(stale && 'text-muted-foreground')}>
                  {stale
                    ? ago == null
                      ? '—'
                      : `cập nhật ${ago} phút trước`
                    : formatUptime(s.uptimeSec)}
                </TableCell>
                <TableCell className='font-mono text-[13px] text-muted-foreground'>
                  {s.agent ?? '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function MonitorPage() {
  const q = useQuery({
    queryKey: monitorKeys.systems,
    queryFn: fetchMonitorSystems,
    refetchInterval: 30_000,
  })
  const systems = q.data ?? []

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Monitor</h2>
          <p className='text-muted-foreground'>
            Tài nguyên máy chủ vpn4 &amp; vpn6 từ Beszel. Tự làm mới 30s.
          </p>
        </div>
        <Button variant='outline' asChild>
          <a href={STATUS_URL} target='_blank' rel='noopener noreferrer'>
            <ExternalLink /> Mở Beszel
          </a>
        </Button>
      </div>

      {q.isPending ? (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className='h-[106px] rounded-xl' />
          ))}
        </div>
      ) : q.isError ? (
        <Card>
          <CardContent className='p-5 text-sm'>
            <p className='font-medium'>Không lấy được số liệu từ Beszel.</p>
            <p className='text-muted-foreground'>
              Máy chủ Beszel có thể đang khởi động lại. Trang tự thử lại sau 30 giây, hoặc
              mở thẳng Beszel bằng nút ở góc phải.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Stats systems={systems} />
      )}

      <section>
        <div className='flex items-center gap-2.5'>
          <h3 className='text-lg font-semibold'>
            Máy chủ <span className='font-medium text-muted-foreground'>({systems.length})</span>
          </h3>
          {q.isFetching ? (
            <Loader2 className='size-3.5 animate-spin text-muted-foreground' aria-label='Đang cập nhật' />
          ) : (
            q.isSuccess && (
              <span className='inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400'>
                <span className='size-1.5 rounded-full bg-current' /> live
              </span>
            )
          )}
        </div>
        <p className='mt-1 mb-3 text-sm text-muted-foreground'>
          Bấm vào một máy để mở Beszel. Thanh %: dưới 70 xanh, 70–90 vàng, trên 90 đỏ.
          Máy mất kết nối hiện mờ, là số cuối cùng Beszel nhận được.
        </p>
        {q.isPending ? <Skeleton className='h-40 rounded-xl' /> : <SystemsTable systems={systems} />}
      </section>
    </Main>
  )
}
