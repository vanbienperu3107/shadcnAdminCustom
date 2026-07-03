import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  homeDerpKeys,
  listHomeDerp,
} from '@/features/home-derp/data/home-derp-api'
import { derpPingKeys, listDerpPing } from './data/derp-ping-api'

function cellClass(rttMs: number | null, ok: boolean): string {
  if (!ok) return 'bg-destructive/10 text-destructive'
  if (rttMs == null) return 'bg-muted text-muted-foreground'
  if (rttMs < 80)
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (rttMs < 150) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-destructive/10 text-destructive'
}

function cellLabel(rttMs: number | null, ok: boolean): string {
  if (!ok) return 'down'
  if (rttMs == null) return '—'
  return `${Math.round(rttMs)}`
}

/** Tab "Ping DERP" trong Machines — ma trận client × DERP region, RTT theo ms
 *  (xem cmd/tailscaled/derppingreport.go, báo cáo mỗi 30s). */
export function DerpPing() {
  const ping = useQuery({
    queryKey: derpPingKeys.all,
    queryFn: listDerpPing,
    refetchInterval: 30_000,
  })
  const regions = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })
  const homeDerp = useQuery({
    queryKey: homeDerpKeys.all,
    queryFn: listHomeDerp,
  })

  const macToHostname = new Map(
    (homeDerp.data ?? []).map((r) => [r.mac, r.hostname])
  )
  const rows = ping.data ?? []
  const regionCols = [...(regions.data ?? [])].sort(
    (a, b) => a.regionId - b.regionId
  )
  const clients = [...new Set(rows.map((r) => r.client))].sort((a, b) =>
    (macToHostname.get(a) ?? a).localeCompare(macToHostname.get(b) ?? b)
  )
  const byClientRegion = new Map(
    rows.map((r) => [`${r.client}:${r.regionId}`, r])
  )

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <p className='text-sm text-muted-foreground'>
        Ping từ mỗi client tới toàn bộ DERP region. Tự làm mới mỗi 30s.
      </p>

      {ping.isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được dữ liệu ping DERP (`/api/telemetry/derp-ping`).
        </div>
      ) : ping.isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : clients.length === 0 ? (
        <div className='rounded-md border p-4 text-sm text-muted-foreground'>
          Chưa có client nào báo cáo.
        </div>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b bg-muted/50'>
                <th className='sticky left-0 bg-muted/50 px-3 py-2 text-start font-medium'>
                  Client
                </th>
                {regionCols.map((r) => (
                  <th
                    key={r.regionId}
                    className='px-3 py-2 text-center font-medium whitespace-nowrap'
                  >
                    {r.code}
                    <span className='ms-1 text-xs text-muted-foreground'>
                      ({r.regionId})
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((mac) => (
                <tr key={mac} className='border-b last:border-0'>
                  <td className='sticky left-0 bg-background px-3 py-2 font-medium whitespace-nowrap'>
                    {macToHostname.get(mac) ?? mac}
                  </td>
                  {regionCols.map((r) => {
                    const cell = byClientRegion.get(`${mac}:${r.regionId}`)
                    return (
                      <td key={r.regionId} className='p-1.5 text-center'>
                        {cell ? (
                          <span
                            className={cn(
                              'inline-block min-w-14 rounded-md px-2 py-1 font-mono text-xs tabular-nums',
                              cellClass(cell.rttMs, cell.ok)
                            )}
                          >
                            {cellLabel(cell.rttMs, cell.ok)}
                          </span>
                        ) : (
                          <span className='inline-block min-w-14 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground'>
                            —
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className='text-xs text-muted-foreground'>
        <span className='rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400'>
          &lt; 80ms
        </span>{' '}
        <span className='rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400'>
          80–150ms
        </span>{' '}
        <span className='rounded bg-destructive/10 px-1.5 py-0.5 text-destructive'>
          down / &gt;150ms
        </span>{' '}
        <span className='rounded bg-muted px-1.5 py-0.5 text-muted-foreground'>
          không có dữ liệu
        </span>
      </p>
    </div>
  )
}
