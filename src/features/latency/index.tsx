import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  derpNameSet,
  fetchLatency,
  fetchMachines,
  hsKeys,
  isDerpNode,
  userName,
} from '@/features/headscale/hs-api'

function num(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${Math.round(n * 10) / 10}ms` : '—'
}

function RelayBadge({ path }: { path: string }) {
  if (!path || path === '—')
    return <span className='text-muted-foreground'>—</span>
  if (path === 'direct') {
    return (
      <Badge
        variant='outline'
        className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      >
        direct (P2P)
      </Badge>
    )
  }
  const region = path.startsWith('derp:') ? path.slice(5) : path
  return (
    <Badge
      variant='outline'
      className='border-violet-500/40 text-violet-600 dark:text-violet-400'
    >
      {region}
    </Badge>
  )
}

type RowData = {
  id?: string
  name: string
  user: string
  ip: string
  derpRegion: string // home DERP region (from src-based lookup)
  derpRttMs: number | null
  online: boolean
  lastSeen?: string
}

function NodeTable({ rows }: { rows: RowData[] }) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead>Tailnet IP</TableHead>
            <TableHead>DERP đang dùng</TableHead>
            <TableHead>Latency đến DERP</TableHead>
            <TableHead>Online</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className='h-16 text-center text-muted-foreground'
              >
                Chưa có dữ liệu.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r, i) => (
              <TableRow
                key={r.id ?? i}
                className={r.online ? '' : 'opacity-50'}
              >
                <TableCell className='font-medium'>{r.name}</TableCell>
                <TableCell className='font-mono text-xs'>{r.ip}</TableCell>
                <TableCell>
                  {r.online ? (
                    <RelayBadge
                      path={r.derpRegion ? `derp:${r.derpRegion}` : ''}
                    />
                  ) : (
                    <span className='text-muted-foreground'>—</span>
                  )}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {r.online && r.derpRttMs != null ? (
                    num(r.derpRttMs)
                  ) : (
                    <span className='text-muted-foreground'>—</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.online ? (
                    <span className='inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400'>
                      <span className='inline-block size-2 rounded-full bg-emerald-500' />
                      online
                    </span>
                  ) : (
                    <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                      <span className='inline-block size-2 rounded-full bg-muted-foreground' />
                      offline
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function Latency() {
  const lat = useQuery({
    queryKey: hsKeys.latency,
    queryFn: fetchLatency,
    refetchInterval: 30_000,
  })
  const mac = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })
  const derp = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })

  const names = derpNameSet(derp.data ?? [])
  const pairs = lat.data?.pairs ?? []

  // Src-based lookup: for each client, find its home DERP region and RTT.
  // pairs shape: { src, dst, last_path, avg_ms } — src populated after Feature L.
  const clientDerpMap = new Map<
    string,
    { region: string; rttMs: number | null }
  >()
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
    if (path.startsWith('derp:') && !clientDerpMap.has(src)) {
      clientDerpMap.set(src, { region: path.slice(5), rttMs: null })
    }
    if (names.has(dst) && rtt !== null) {
      const info = clientDerpMap.get(src)
      if (info) {
        if (info.rttMs === null) info.rttMs = rtt
      } else {
        clientDerpMap.set(src, { region: '', rttMs: rtt })
      }
    }
  }

  const nodes = mac.data?.nodes ?? []
  const allRows: RowData[] = nodes.map((n) => {
    const key = (n.givenName || n.name || '').toLowerCase()
    const info = clientDerpMap.get(key)
    return {
      id: n.id,
      name: n.givenName || n.name || '—',
      user: userName(n.user),
      ip: n.ipAddresses?.[0] ?? '—',
      derpRegion: info?.region ?? '',
      derpRttMs: info?.rttMs ?? null,
      online: !!n.online,
      lastSeen: n.lastSeen,
    }
  })

  const clientRows = allRows
    .filter((r) => !isDerpNode(r.name, names))
    .sort((a, b) => Number(b.online) - Number(a.online))
  const infraRows = allRows
    .filter((r) => isDerpNode(r.name, names))
    .sort((a, b) => Number(b.online) - Number(a.online))

  const ready = mac.data?.configured && !lat.data?.error

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>
          Client đang dùng DERP nào
        </h2>
        <p className='text-muted-foreground'>
          Kết nối và latency của từng node đến DERP relay. Tự làm mới 30s.
        </p>
      </div>

      {lat.isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không lấy được dữ liệu latency từ server.
        </div>
      ) : !ready && (lat.isLoading || mac.isLoading) ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : !mac.data?.configured ? (
        <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm'>
          Cần <span className='font-mono'>HEADSCALE_API_KEY</span> để map node ↔
          IP.
        </div>
      ) : (
        <>
          <Tabs defaultValue='clients'>
            <TabsList>
              <TabsTrigger value='clients'>
                Client
                <span className='ms-1.5 text-muted-foreground'>
                  ({clientRows.length})
                </span>
              </TabsTrigger>
              <TabsTrigger value='infra'>
                Hạ tầng / Collector
                <span className='ms-1.5 text-muted-foreground'>
                  ({infraRows.length})
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value='clients' className='mt-4'>
              <NodeTable rows={clientRows} />
            </TabsContent>
            <TabsContent value='infra' className='mt-4'>
              <NodeTable rows={infraRows} />
            </TabsContent>
          </Tabs>
          <p className='text-xs text-muted-foreground'>
            <b>direct (P2P)</b> = kết nối thẳng không qua DERP ·{' '}
            <b className='text-violet-600 dark:text-violet-400'>vpnX-vn</b> =
            đang relay qua DERP region đó. Cột DERP hiển thị sau khi Feature L
            (latency → Neon) hoàn thành.
          </p>
        </>
      )}
    </Main>
  )
}
