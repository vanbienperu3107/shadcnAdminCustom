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
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Main } from '@/components/layout/main'
import { derpKeys, fetchHealth, listDerp } from '@/features/derp/data/derp-api'
import {
  apiKeyRefresh,
  apiKeySeed,
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
  const [seedInput, setSeedInput] = useState('')

  const refreshMut = useMutation({
    mutationFn: apiKeyRefresh,
    onSuccess: (data) => qc.setQueryData(hsKeys.apiKey, data),
  })
  const seedMut = useMutation({
    mutationFn: (key: string) => apiKeySeed(key),
    onSuccess: (data) => {
      qc.setQueryData(hsKeys.apiKey, data)
      setSeedInput('')
    },
  })

  const spinning = refreshMut.isPending || seedMut.isPending
  const errMsg = (refreshMut.error || seedMut.error)?.message ?? status.error

  return (
    <Card>
      <CardContent className='flex flex-col gap-3 p-5'>
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
              disabled={spinning}
              onClick={() => refreshMut.mutate()}
            >
              <RefreshCw className={spinning ? 'animate-spin' : ''} />
              Làm mới ngay
            </Button>
          )}
        </div>

        {status.configured ? (
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
              <b className='text-foreground'>Next refresh:</b>{' '}
              {fmt(status.nextRefreshAt)}{' '}
              <span className='text-muted-foreground'>(tự động 24h)</span>
            </span>
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <p className='text-xs text-muted-foreground'>
              Nhập API key ban đầu (chỉ cần 1 lần — sau đó tự xoay vòng mỗi
              24h):
            </p>
            <div className='flex gap-2'>
              <Input
                className='font-mono text-xs'
                placeholder='abc123.xxxx…'
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                disabled={spinning}
              />
              <Button
                size='sm'
                disabled={spinning || seedInput.trim().length < 10}
                onClick={() => seedMut.mutate(seedInput.trim())}
              >
                Lưu
              </Button>
            </div>
            <code className='rounded bg-muted px-2 py-1 text-xs'>
              docker exec headscale headscale apikeys create --expiration 8760h
            </code>
          </div>
        )}

        {errMsg && <p className='text-xs text-destructive'>Lỗi: {errMsg}</p>}
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

      {/* API Key management */}
      {apiKey.data && <ApiKeyCard status={apiKey.data} />}
    </Main>
  )
}
