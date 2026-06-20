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
import { Main } from '@/components/layout/main'
import {
  fetchLatency,
  fetchMachines,
  hsKeys,
  userName,
} from '@/features/headscale/hs-api'

function num(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${Math.round(n * 10) / 10}ms` : '—'
}

// last_path: "derp:vpn4-vn" -> relay qua vpn4-vn; "direct" -> P2P; else "—"
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

  const pairs = lat.data?.pairs ?? []
  const relayByName = new Map<string, { path: string; avg: unknown }>()
  for (const p of pairs) {
    const dst = String(p.dst ?? '').toLowerCase()
    if (dst)
      relayByName.set(dst, { path: String(p.last_path ?? ''), avg: p.avg_ms })
  }

  const nodes = mac.data?.nodes ?? []
  const rows = nodes.map((n) => {
    const key = (n.givenName || n.name || '').toLowerCase()
    const m = relayByName.get(key)
    return {
      name: n.givenName || n.name || '—',
      user: userName(n.user),
      ip: n.ipAddresses?.[0] ?? '—',
      path: m?.path ?? '',
      avg: m?.avg,
      online: !!n.online,
    }
  })
  // online + đang relay lên trước
  rows.sort((a, b) => Number(b.online) - Number(a.online))

  const ready = mac.data?.configured && !lat.data?.error

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>
          Client đang dùng DERP nào
        </h2>
        <p className='text-muted-foreground'>
          Mỗi node kết nối tới tailnet qua đâu (đo bởi node-dedup / LocalAPI).
          Tự làm mới 30s.
        </p>
      </div>

      {lat.isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không lấy được dữ liệu từ node-dedup (collector :8090).
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
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Tailnet IP</TableHead>
                  <TableHead>Kết nối qua</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Online</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      Chưa có dữ liệu.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, i) => (
                    <TableRow key={i} className={r.online ? '' : 'opacity-50'}>
                      <TableCell className='font-medium'>{r.name}</TableCell>
                      <TableCell className='font-mono text-xs'>
                        {r.ip}
                      </TableCell>
                      <TableCell>
                        {r.online ? (
                          <RelayBadge path={r.path} />
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {r.online ? num(r.avg) : '—'}
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
          <p className='text-xs text-muted-foreground'>
            <b>direct</b> = kết nối thẳng P2P (không qua DERP) ·{' '}
            <b className='text-violet-600 dark:text-violet-400'>vpnX-vn</b> =
            đang relay qua DERP region đó.
          </p>
        </>
      )}
    </Main>
  )
}
