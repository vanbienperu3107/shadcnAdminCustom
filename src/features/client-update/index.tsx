import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  clientUpdateKeys,
  getClientUpdate,
  putClientUpdate,
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
        sha256) và tự khởi động lại — kiểm tra lúc khởi động và mỗi 6h. Tắt =
        dừng cập nhật toàn bộ (kill-switch).
      </p>

      {/* Pin version — đóng băng fleet ở 1 build cụ thể (rollback an toàn). */}
      <div className='flex flex-col gap-1.5 rounded-md border p-3'>
        <label className='text-sm font-medium'>Ghim build (rollback)</label>
        <p className='text-xs text-muted-foreground'>
          Mặc định “Mới nhất”. Chọn 1 build để đóng băng — client sẽ cập nhật (kể
          cả lùi) về đúng build đó.
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
    </div>
  )
}
