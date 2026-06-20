import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { DashHeader } from '@/components/layout/page-header'
import { fetchLatency, hsKeys } from '@/features/headscale/hs-api'

function cell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function Latency() {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.latency,
    queryFn: fetchLatency,
    refetchInterval: 30_000,
  })

  const pairs = data?.pairs ?? []
  const cols = pairs.length > 0 ? Object.keys(pairs[0]) : []

  return (
    <>
      <DashHeader />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Latency</h2>
          <p className='text-muted-foreground'>
            Độ trễ giữa các node DERP (đo bởi node-dedup / ping-reporter).
            {data?.window_s ? ` Cửa sổ ${data.window_s}s.` : ''} Tự làm mới 30s.
          </p>
        </div>

        {isError || data?.error ? (
          <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
            Không lấy được dữ liệu latency từ node-dedup (kiểm tra collector
            :8090).
          </div>
        ) : isLoading ? (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        ) : pairs.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            Chưa có số liệu latency (collector chưa nhận report nào).
          </p>
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairs.map((row, i) => (
                  <TableRow key={i}>
                    {cols.map((c) => (
                      <TableCell key={c} className='font-mono text-xs'>
                        {cell(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}
