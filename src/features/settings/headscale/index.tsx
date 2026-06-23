import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, RefreshCw, Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  apiKeyRefresh,
  fetchApiKeyStatus,
  hsKeys,
  type ApiKeyStatus,
} from '@/features/headscale/hs-api'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('vi-VN', { hour12: false })
}

function ApiKeyCard({ status }: { status: ApiKeyStatus }) {
  const qc = useQueryClient()
  const [errMsg, setErrMsg] = useState('')
  const [okMsg, setOkMsg] = useState('')

  const refreshMut = useMutation({
    mutationFn: apiKeyRefresh,
    onSuccess: (data) => {
      qc.setQueryData(hsKeys.apiKey, data)
      setOkMsg('Key đã xoay vòng thành công!')
      setErrMsg('')
    },
    onError: (e: Error) => {
      setErrMsg(e.message)
      setOkMsg('')
    },
  })

  return (
    <div className='flex flex-col gap-4'>
      {/* Header + status */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <KeyRound className='size-5 text-muted-foreground' />
          <span className='font-semibold'>Headscale API Key</span>
          {status.configured ? (
            <Badge
              variant='outline'
              className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
            >
              <span className='me-1 inline-block size-2 rounded-full bg-emerald-500' />
              Đã cấu hình
            </Badge>
          ) : (
            <Badge
              variant='outline'
              className='border-amber-500/40 text-amber-600 dark:text-amber-400'
            >
              Chưa cấu hình
            </Badge>
          )}
        </div>
        {status.configured && (
          <Button
            size='sm'
            variant='outline'
            disabled={refreshMut.isPending}
            onClick={() => {
              setErrMsg('')
              setOkMsg('')
              refreshMut.mutate()
            }}
          >
            <RefreshCw className={refreshMut.isPending ? 'animate-spin' : ''} />
            Xoay vòng key
          </Button>
        )}
      </div>

      {/* Metadata */}
      {status.configured && (
        <div className='grid gap-2 text-sm sm:grid-cols-2'>
          <div className='flex flex-col gap-0.5 rounded-md border p-3'>
            <span className='text-xs text-muted-foreground'>Prefix</span>
            <span className='font-mono font-medium'>
              {status.prefix ?? '—'}
            </span>
          </div>
          <div className='flex flex-col gap-0.5 rounded-md border p-3'>
            <span className='text-xs text-muted-foreground'>Seeded</span>
            <span className='font-medium'>{fmt(status.seededAt)}</span>
          </div>
          <div className='flex flex-col gap-0.5 rounded-md border p-3'>
            <span className='text-xs text-muted-foreground'>Last refresh</span>
            <span className='font-medium'>{fmt(status.refreshedAt)}</span>
          </div>
          <div className='flex flex-col gap-0.5 rounded-md border p-3'>
            <span className='text-xs text-muted-foreground'>
              Next auto-refresh
            </span>
            <span className='font-medium'>
              {fmt(status.nextRefreshAt)}{' '}
              <span className='text-xs text-muted-foreground'>(24h)</span>
            </span>
          </div>
        </div>
      )}

      {/* Feedback */}
      {okMsg && (
        <p className='text-sm text-emerald-600 dark:text-emerald-400'>
          {okMsg}
        </p>
      )}
      {errMsg && <p className='text-sm text-destructive'>Lỗi: {errMsg}</p>}

      {/* Not configured guide */}
      {!status.configured && (
        <div className='space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-muted-foreground'>
          <p>
            Key được tạo tự động mỗi lần deploy. Để tạo ngay không cần deploy:
          </p>
          <div className='flex items-start gap-1.5'>
            <Terminal className='mt-0.5 size-3.5 shrink-0 text-foreground' />
            <code className='font-mono text-foreground'>
              docker exec headscale headscale apikeys create --expiration 8760h
            </code>
          </div>
          <p>
            Lưu kết quả vào GitHub Secret{' '}
            <code className='font-mono text-foreground'>HEADSCALE_API_KEY</code>{' '}
            — backend tự seed vào DB khi khởi động, tự xoay vòng mỗi 24h.
          </p>
        </div>
      )}
    </div>
  )
}

export function SettingsHeadscale() {
  const apiKey = useQuery({
    queryKey: hsKeys.apiKey,
    queryFn: fetchApiKeyStatus,
    refetchInterval: 60_000,
  })

  return (
    <div className='flex flex-1 flex-col'>
      <div>
        <h3 className='text-lg font-medium'>Headscale</h3>
        <p className='text-sm text-muted-foreground'>
          Quản lý kết nối đến Headscale control plane.
        </p>
      </div>
      <Separator className='my-4' />
      <div className='max-w-2xl'>
        {apiKey.isLoading ? (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        ) : apiKey.data ? (
          <ApiKeyCard status={apiKey.data} />
        ) : (
          <p className='text-sm text-destructive'>
            Không lấy được trạng thái API key.
          </p>
        )}
      </div>
    </div>
  )
}
