import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  KeyRound,
  Loader2,
  Network,
  Radio,
  RefreshCw,
  Server,
  Users,
  Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { derpKeys, fetchHealth, listDerp } from '@/features/derp/data/derp-api'
import {
  apiKeyGenerate,
  apiKeyRefresh,
  derpNameSet,
  fetchApiKeyStatus,
  fetchHsUsers,
  fetchMachines,
  hsKeys,
  isDerpNode,
  type ApiKeyStatus,
} from '@/features/headscale/hs-api'

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: typeof Server
  label: string
  value: ReactNode
  sub?: string
  to: '/overview' | '/machines' | '/tailnet-users' | '/latency' | '/derp'
}) {
  return (
    <Link to={to}>
      <Card className='transition-colors hover:bg-muted/40'>
        <CardContent className='flex items-center gap-4 p-5'>
          <Icon className='size-8 text-muted-foreground' />
          <div className='ms-auto text-end'>
            <div className='text-sm text-muted-foreground'>{label}</div>
            <div className='text-3xl font-bold tracking-tight'>{value}</div>
            {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('vi-VN', { hour12: false })
}

function ApiKeyCard({
  status,
  onSetRefetchInterval,
}: {
  status: ApiKeyStatus
  refetchInterval?: number
  onSetRefetchInterval: (ms: number) => void
}) {
  const qc = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // Khi đang chờ workflow → poll nhanh 5s; khi key xuất hiện → dừng polling nhanh.
  // setTimeout để setState được gọi trong callback (không phải synchronously trong effect).
  useEffect(() => {
    if (!generating || !status.configured) return
    const t = setTimeout(() => {
      setGenerating(false)
      setGenMsg('Key đã tạo và lưu vào DB thành công!')
      onSetRefetchInterval(60_000)
    }, 0)
    return () => clearTimeout(t)
  }, [generating, status.configured, onSetRefetchInterval])

  const generateMut = useMutation({
    mutationFn: apiKeyGenerate,
    onSuccess: (d) => {
      setGenMsg(d.message)
      setErrMsg('')
      setGenerating(true)
      onSetRefetchInterval(5_000) // poll nhanh chờ webhook
    },
    onError: (e: Error) => {
      setErrMsg(e.message)
      setGenerating(false)
    },
  })

  const refreshMut = useMutation({
    mutationFn: apiKeyRefresh,
    onSuccess: (data) => qc.setQueryData(hsKeys.apiKey, data),
    onError: (e: Error) => setErrMsg(e.message),
  })

  const busy = generateMut.isPending || refreshMut.isPending || generating

  return (
    <Card>
      <CardContent className='flex flex-col gap-3 p-5'>
        {/* Header */}
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

          <div className='flex gap-2'>
            {/* Nút tạo key qua GitHub workflow (hiển thị cả khi chưa lẫn đã cấu hình) */}
            <Button
              size='sm'
              variant={status.configured ? 'ghost' : 'default'}
              disabled={busy}
              onClick={() => {
                setErrMsg('')
                setGenMsg('')
                generateMut.mutate()
              }}
              title='Kích hoạt GitHub workflow SSH vào vpn2 tạo key mới'
            >
              {generating ? <Loader2 className='animate-spin' /> : <Wand2 />}
              {status.configured ? 'Tạo key mới' : 'Tạo Headscale API Key'}
            </Button>

            {/* Nút làm mới nhanh (dùng key hiện tại gọi headscale API) — chỉ khi đã có key */}
            {status.configured && (
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => {
                  setErrMsg('')
                  setGenMsg('')
                  refreshMut.mutate()
                }}
                title='Xoay vòng key qua headscale REST API (không cần SSH)'
              >
                <RefreshCw
                  className={refreshMut.isPending ? 'animate-spin' : ''}
                />
                Xoay vòng
              </Button>
            )}
          </div>
        </div>

        {/* Key metadata */}
        {status.configured && (
          <div className='grid gap-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4'>
            <span>
              <b className='text-foreground'>Prefix:</b>{' '}
              <span className='font-mono'>{status.prefix ?? '—'}</span>
            </span>
            <span>
              <b className='text-foreground'>Seeded:</b> {fmt(status.seededAt)}
            </span>
            <span>
              <b className='text-foreground'>Last refresh:</b>{' '}
              {fmt(status.refreshedAt)}
            </span>
            <span>
              <b className='text-foreground'>Next auto-refresh:</b>{' '}
              {fmt(status.nextRefreshAt)}{' '}
              <span className='text-muted-foreground'>(24h)</span>
            </span>
          </div>
        )}

        {/* Trạng thái workflow đang chạy */}
        {generating && (
          <div className='flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-600 dark:text-blue-400'>
            <Loader2 className='size-3 animate-spin' />
            GitHub workflow đang chạy — SSH vào vpn2 tạo key... (~1 phút)
          </div>
        )}

        {/* Thông báo */}
        {genMsg && !generating && (
          <p className='text-xs text-emerald-600 dark:text-emerald-400'>
            {genMsg}
          </p>
        )}
        {errMsg && <p className='text-xs text-destructive'>Lỗi: {errMsg}</p>}

        {/* Chưa cấu hình: hướng dẫn */}
        {!status.configured && !generating && (
          <p className='text-xs text-muted-foreground'>
            Bấm <b className='text-foreground'>Tạo Headscale API Key</b> — hệ
            thống tự SSH vào vpn2, tạo key và lưu vào DB. Từ đó tự xoay vòng mỗi
            24h, không cần thao tác thêm.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function Overview() {
  const [apiKeyInterval, setApiKeyInterval] = useState(60_000)

  const derp = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })
  const health = useQuery({
    queryKey: derpKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  })
  const machines = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })
  const users = useQuery({ queryKey: hsKeys.users, queryFn: fetchHsUsers })
  const apiKey = useQuery({
    queryKey: hsKeys.apiKey,
    queryFn: fetchApiKeyStatus,
    refetchInterval: apiKeyInterval,
  })

  const regions = derp.data ?? []
  const activeRegions = regions.filter((r) => r.enabled && !r.paused).length
  const healthUp = (health.data ?? []).filter((h) => h.up).length
  const healthDown = (health.data ?? []).filter((h) => !h.up).length

  const names = derpNameSet(regions)
  const realNodes = (machines.data?.nodes ?? []).filter(
    (n) => !isDerpNode(n.givenName || n.name, names)
  )
  const realOnline = realNodes.filter((n) => n.online).length
  const hsOk = machines.data?.configured

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Overview</h2>
        <p className='text-muted-foreground'>
          Tổng quan Headscale tailnet &amp; DERP. Tự làm mới 30s.
        </p>
      </div>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        <Stat
          icon={Server}
          label='Machines'
          value={hsOk ? realNodes.length : '—'}
          sub={
            hsOk ? `${realOnline} online · chỉ thiết bị thật` : 'cần API key'
          }
          to='/machines'
        />
        <Stat
          icon={Users}
          label='Users'
          value={hsOk ? (users.data?.users.length ?? 0) : '—'}
          sub={hsOk ? 'tailnet users' : 'cần API key'}
          to='/tailnet-users'
        />
        <Stat
          icon={Network}
          label='DERP regions'
          value={regions.length}
          sub={`${activeRegions} đang bật`}
          to='/derp'
        />
        <Stat
          icon={Radio}
          label='DERP health'
          value={`${healthUp}/${healthUp + healthDown}`}
          sub={healthDown > 0 ? `${healthDown} chết` : 'tất cả sống'}
          to='/derp'
        />
        <Stat
          icon={Activity}
          label='Client → DERP'
          value={hsOk ? realOnline : '—'}
          sub='xem định tuyến'
          to='/latency'
        />
      </div>

      {apiKey.data && (
        <ApiKeyCard
          status={apiKey.data}
          refetchInterval={apiKeyInterval}
          onSetRefetchInterval={setApiKeyInterval}
        />
      )}
    </Main>
  )
}
