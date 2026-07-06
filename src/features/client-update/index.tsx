import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Dot, DownloadCloud, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  checkNowClientUpdate,
  clientUpdateKeys,
  getClientUpdate,
  getVersionHistory,
  putClientUpdate,
  type VersionHistoryRow,
} from './data/client-update-api'

/** Card cấu hình auto-update portable client (Settings → Headscale).
 *  enabled = kill-switch; pinnedBuild = đóng băng fleet ở 1 build (rollback). */
export function ClientAutoUpdateCard() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: clientUpdateKeys.all,
    queryFn: getClientUpdate,
    refetchInterval: 60_000,
  })

  const mut = useMutation({
    mutationFn: putClientUpdate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientUpdateKeys.all })
      toast.success('Đã lưu cấu hình auto-update')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const checkNowMut = useMutation({
    mutationFn: checkNowClientUpdate,
    onSuccess: () =>
      toast.success('Đã yêu cầu toàn bộ client kiểm tra cập nhật (≤20s)'),
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading)
    return <p className='text-sm text-muted-foreground'>Đang tải…</p>
  if (isError || !data)
    return (
      <p className='text-sm text-destructive'>
        Không lấy được cấu hình auto-update.
      </p>
    )

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <DownloadCloud className='size-5 text-muted-foreground' />
          <span className='font-semibold'>Tự động cập nhật client</span>
          <Badge variant='outline' className='font-mono'>
            build mới nhất: {data.latestBuild ?? '—'}
          </Badge>
        </div>
        <Switch
          checked={data.enabled}
          disabled={mut.isPending}
          onCheckedChange={(v) => mut.mutate({ enabled: v })}
        />
      </div>

      <p className='text-sm text-muted-foreground'>
        Khi bật, portable client tự tải bản mới nhất từ GitHub Release (verify
        sha256) và tự khởi động lại — kiểm tra lúc khởi động và mỗi phút. Tắt =
        dừng cập nhật toàn bộ (kill-switch).
      </p>

      {/* Push tức thì: báo mọi client kiểm tra cập nhật liền (không chờ chu kỳ). */}
      <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3'>
        <div>
          <p className='text-sm font-medium'>Cập nhật ngay (toàn fleet)</p>
          <p className='text-xs text-muted-foreground'>
            Báo mọi client kiểm tra + tự cập nhật liền qua vòng poll 20s, thay
            vì chờ tới chu kỳ tự kiểm tra (mỗi phút). Chỉ có tác dụng khi đang
            bật auto-update.
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          disabled={checkNowMut.isPending || !data.enabled}
          onClick={() => checkNowMut.mutate()}
        >
          <RefreshCw className={checkNowMut.isPending ? 'animate-spin' : ''} />
          Cập nhật ngay
        </Button>
      </div>

      {/* Pin version — đóng băng fleet ở 1 build cụ thể (rollback an toàn). */}
      <div className='flex flex-col gap-1.5 rounded-md border p-3'>
        <label className='text-sm font-medium'>Ghim build (rollback)</label>
        <p className='text-xs text-muted-foreground'>
          Mặc định “Mới nhất”. Chọn 1 build để đóng băng — client sẽ cập nhật
          (kể cả lùi) về đúng build đó.
        </p>
        <select
          className='mt-1 h-9 rounded-md border bg-transparent px-2 text-sm disabled:opacity-50'
          disabled={mut.isPending || !data.enabled}
          value={data.pinnedBuild ?? ''}
          onChange={(e) =>
            mut.mutate({
              pinnedBuild: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value=''>Mới nhất (không ghim)</option>
          {data.builds.map((b) => (
            <option key={b.build} value={b.build}>
              build {b.build} — {b.version}
            </option>
          ))}
        </select>
      </div>

      <VersionHistoryList />
    </div>
  )
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { hour12: false })
}

/** Lịch sử nâng/hạ cấp build của từng client (toàn fleet, mới nhất trước). */
function VersionHistoryList() {
  const { data, isLoading, isError } = useQuery({
    queryKey: [...clientUpdateKeys.all, 'history'],
    queryFn: () => getVersionHistory(50),
    refetchInterval: 30_000,
  })

  return (
    <div className='flex flex-col gap-2 rounded-md border p-3'>
      <label className='text-sm font-medium'>
        Lịch sử nâng/hạ cấp phiên bản
      </label>
      {isLoading ? (
        <p className='text-xs text-muted-foreground'>Đang tải…</p>
      ) : isError ? (
        <p className='text-xs text-destructive'>Không tải được lịch sử.</p>
      ) : !data || data.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          Chưa có thay đổi phiên bản nào được ghi.
        </p>
      ) : (
        <ul className='flex flex-col divide-y'>
          {data.map((r) => (
            <VersionHistoryItem key={r.id} row={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function VersionHistoryItem({ row }: { row: VersionHistoryRow }) {
  const meta =
    row.direction === 'upgrade'
      ? {
          Icon: ArrowUp,
          cls: 'text-emerald-600 dark:text-emerald-400',
          label: 'Nâng cấp',
        }
      : row.direction === 'downgrade'
        ? {
            Icon: ArrowDown,
            cls: 'text-amber-600 dark:text-amber-400',
            label: 'Hạ cấp',
          }
        : { Icon: Dot, cls: 'text-muted-foreground', label: 'Lần đầu' }
  const { Icon } = meta
  return (
    <li className='flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm'>
      <Icon className={`size-4 shrink-0 ${meta.cls}`} />
      <span className='font-medium'>{row.hostname || row.mac || '—'}</span>
      <span className='font-mono text-xs tabular-nums'>
        {row.fromBuild != null ? `build ${row.fromBuild}` : '—'} →{' '}
        {row.toBuild != null ? `build ${row.toBuild}` : '—'}
      </span>
      <Badge variant='outline' className={`text-xs ${meta.cls}`}>
        {meta.label}
      </Badge>
      <span className='ms-auto font-mono text-xs text-muted-foreground'>
        {fmtTime(row.changedAt)}
      </span>
    </li>
  )
}
