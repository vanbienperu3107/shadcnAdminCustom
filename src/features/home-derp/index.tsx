import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { homeDerpKeys, listHomeDerp } from './data/home-derp-api'

const STALE_AFTER_MS = 30_000 // > 10x chu kỳ báo cáo (3s) coi như mất kết nối

/** "Giờ hiện tại" dạng state, tick mỗi giây — tránh gọi Date.now() thẳng
 *  trong render (impure, vi phạm react-hooks/purity). */
function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function fmtMs(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 10) / 10} ms`
}

function fmtAgo(now: number, iso: string): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (secs < 2) return 'vừa xong'
  if (secs < 60) return `${secs}s trước`
  return `${Math.round(secs / 60)}p trước`
}

/** Tab "Home DERP" trong Machines — client tự báo cáo home DERP + latency
 *  tới controller mỗi 3s (xem cmd/tailscaled/homederpreport.go). */
export function HomeDerp() {
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: homeDerpKeys.all,
    queryFn: listHomeDerp,
    // 3s là quá dày (ngưỡng cũ đánh giá staleness ở 30s). 15s đủ tươi mà giảm
    // mạnh tải nền/mạng khi tab mở lâu.
    refetchInterval: 15_000,
  })
  const now = useNow()
  const [showOffline, setShowOffline] = useState(false)

  const allRows = [...data].sort((a, b) => a.hostname.localeCompare(b.hostname))
  const isOnline = (r: (typeof allRows)[number]) =>
    now - new Date(r.reportedAt).getTime() <= STALE_AFTER_MS
  const offlineCount = allRows.filter((r) => !isOnline(r)).length
  // Mặc định ẩn node offline (stale > 30s); có toggle để hiện lại khi cần.
  const rows = showOffline ? allRows : allRows.filter(isOnline)

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          Home DERP hiện tại của từng client + latency tới controller. Tự làm
          mới mỗi 3s.
        </p>
        {offlineCount > 0 && (
          <button
            type='button'
            onClick={() => setShowOffline((v) => !v)}
            className='text-xs text-muted-foreground underline-offset-2 hover:underline'
          >
            {showOffline
              ? `Ẩn ${offlineCount} node offline`
              : `Hiện ${offlineCount} node offline`}
          </button>
        )}
      </div>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được dữ liệu home-DERP (`/api/telemetry/home-derp`).
        </div>
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : (
        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Home DERP</TableHead>
                <TableHead>Latency → controller</TableHead>
                <TableHead>Cập nhật lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='h-16 text-center text-muted-foreground'
                  >
                    Chưa có client nào báo cáo.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const stale =
                    now - new Date(r.reportedAt).getTime() > STALE_AFTER_MS
                  return (
                    <TableRow key={r.mac} className={stale ? 'opacity-50' : ''}>
                      <TableCell className='font-medium'>
                        <span className='inline-flex items-center gap-2'>
                          <span
                            className={
                              'inline-block size-2 rounded-full ' +
                              (stale ? 'bg-muted-foreground' : 'bg-emerald-500')
                            }
                          />
                          {r.hostname}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.homeRegionCode ? (
                          <>
                            {r.homeRegionCode}
                            {r.homeRegionId != null && (
                              <span className='ms-1 text-xs text-muted-foreground'>
                                ({r.homeRegionId})
                              </span>
                            )}
                          </>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='font-mono text-xs tabular-nums'>
                        {fmtMs(r.controllerLatencyMs)}
                      </TableCell>
                      <TableCell className='font-mono text-xs text-muted-foreground'>
                        {fmtAgo(now, r.reportedAt)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
