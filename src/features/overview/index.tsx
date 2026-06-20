import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Activity,
  KeyRound,
  Network,
  Radio,
  RefreshCw,
  Server,
  Terminal,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { derpKeys, fetchHealth, listDerp } from '@/features/derp/data/derp-api'
import {
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

          {/* Xoay vòng — chỉ khi đã có key */}
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

        {/* Thông báo */}
        {okMsg && <p className='text-xs text-emerald-600 dark:text-emerald-400'>{okMsg}</p>}
        {errMsg && <p className='text-xs text-destructive'>Lỗi: {errMsg}</p>}

        {/* Chưa cấu hình: hướng dẫn */}
        {!status.configured && (
          <div className='space-y-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-muted-foreground'>
            <p>Key được tạo tự động mỗi lần deploy. Để tạo ngay không cần deploy:</p>
            <div className='flex items-start gap-1.5'>
              <Terminal className='mt-0.5 size-3 shrink-0 text-foreground' />
              <code className='font-mono text-foreground'>
                docker exec headscale headscale apikeys create --expiration 8760h
              </code>
            </div>
            <p>
              Lưu kết quả vào GitHub Secret{' '}
              <code className='font-mono text-foreground'>HEADSCALE_API_KEY</code> — backend tự
              seed vào DB khi khởi động. Từ đó tự xoay vòng mỗi 24h.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Overview() {
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
    refetchInterval: 60_000,
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

      {apiKey.data && <ApiKeyCard status={apiKey.data} />}
    </Main>
  )
}
