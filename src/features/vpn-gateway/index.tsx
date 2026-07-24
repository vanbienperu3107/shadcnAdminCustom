import { type ReactNode, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Play, Plus, RotateCw, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  createDomain,
  deleteDomain,
  gatewayAction,
  listDomains,
  listGateways,
  updateDomain,
  vpnKeys,
  type VpnGateway,
  type VpnHealthStatus,
} from './data/vpn-api'

const HEALTH: Record<
  VpnHealthStatus,
  { label: string; dot: string; text: string }
> = {
  healthy: {
    label: 'Đang hoạt động',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  connecting: {
    label: 'Đang kết nối',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  down: {
    label: 'Rớt kết nối',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
  },
  stale: {
    label: 'Mất tín hiệu',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
  },
  stopped: {
    label: 'Đã dừng',
    dot: 'bg-zinc-400',
    text: 'text-muted-foreground',
  },
  unknown: {
    label: 'Chưa có dữ liệu',
    dot: 'bg-zinc-400',
    text: 'text-muted-foreground',
  },
}

function ago(sec: number | null): string {
  if (sec == null) return 'chưa báo cáo'
  if (sec < 60) return `${sec}s trước`
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`
  return `${Math.floor(sec / 3600)} giờ trước`
}

export function VpnGatewayPage() {
  const {
    data: gateways = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: vpnKeys.gateways, queryFn: listGateways })

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <p className='text-sm text-muted-foreground'>
        Cổng VPN giữ phiên OpenVPN thường trực. Client trỏ PAC qua đây để vào
        các trang chỉ mạng VPN mới tới được (vd{' '}
        <span className='font-mono'>jump.bitel.com.pe</span>) mà không máy nào
        phải tự chạy OpenVPN.
      </p>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được cổng VPN. Kiểm tra backend (/api/vpn/gateways).
        </div>
      ) : isLoading ? (
        <div className='text-sm text-muted-foreground'>Đang tải…</div>
      ) : gateways.length === 0 ? (
        <div className='rounded-md border p-6 text-center text-sm text-muted-foreground'>
          Chưa có cổng VPN nào. Cổng được khai báo lúc deploy (bootstrap từ
          env).
        </div>
      ) : (
        gateways.map((g) => <GatewayCard key={g.id} gw={g} />)
      )}
    </div>
  )
}

function GatewayCard({ gw }: { gw: VpnGateway }) {
  const qc = useQueryClient()
  const h = HEALTH[gw.health?.status ?? 'unknown']
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: vpnKeys.gateways })

  const act = useMutation({
    mutationFn: (action: 'start' | 'stop' | 'restart') =>
      gatewayAction(gw.id, action),
    onSuccess: (_d, action) => {
      invalidate()
      const msg = {
        start: 'Đã yêu cầu bật',
        stop: 'Đã yêu cầu dừng',
        restart: 'Đã yêu cầu khởi động lại',
      }
      toast.success(msg[action])
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Lỗi thao tác'),
  })

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-4 space-y-0'>
        <div className='space-y-1'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Globe className='size-4 text-violet-500' />
            {gw.name}
            {gw.nodeHostname ? (
              <span className='font-mono text-xs text-muted-foreground'>
                · {gw.nodeHostname}
              </span>
            ) : null}
          </CardTitle>
          <div
            className={cn(
              'flex items-center gap-2 text-sm font-medium',
              h.text
            )}
          >
            <span className={cn('size-2 rounded-full', h.dot)} />
            {h.label}
            <span className='text-xs font-normal text-muted-foreground'>
              (cập nhật {ago(gw.health?.ageSec ?? null)})
            </span>
          </div>
        </div>
        <div className='flex shrink-0 gap-2'>
          {gw.desiredState === 'down' ? (
            <Button
              size='sm'
              onClick={() => act.mutate('start')}
              disabled={act.isPending}
            >
              <Play className='size-4' /> Bật
            </Button>
          ) : (
            <>
              <Button
                size='sm'
                variant='outline'
                onClick={() => act.mutate('restart')}
                disabled={act.isPending}
              >
                <RotateCw className='size-4' /> Khởi động lại
              </Button>
              <Button
                size='sm'
                variant='outline'
                className='text-destructive'
                onClick={() => act.mutate('stop')}
                disabled={act.isPending}
              >
                <Square className='size-4' /> Dừng
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <dl className='grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3'>
          <Field label='IP tailnet'>
            <span className='font-mono'>
              {gw.tailnetIp ? `${gw.tailnetIp}:${gw.proxyPort}` : '—'}
            </span>
          </Field>
          <Field label='Đường hầm VPN'>
            <span className='font-mono'>{gw.tunIp ?? '—'}</span>
          </Field>
          <Field label='IP ra internet'>
            {gw.egressIp ? (
              <span className='font-mono text-emerald-600 dark:text-emerald-400'>
                {gw.egressIp} ✓
              </span>
            ) : (
              <span className='text-muted-foreground'>—</span>
            )}
          </Field>
        </dl>
        {gw.lastError ? (
          <div className='rounded-md border border-destructive/40 bg-destructive/5 p-2 font-mono text-xs text-destructive'>
            {gw.lastError}
          </div>
        ) : null}

        <DomainsSection
          gatewayId={gw.id}
          tailnetIp={gw.tailnetIp}
          proxyPort={gw.proxyPort}
        />
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='space-y-0.5'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function DomainsSection({
  gatewayId,
  tailnetIp,
  proxyPort,
}: {
  gatewayId: number
  tailnetIp: string | null
  proxyPort: number
}) {
  const qc = useQueryClient()
  const [newDomain, setNewDomain] = useState('')
  const { data: domains = [] } = useQuery({
    queryKey: vpnKeys.domains(gatewayId),
    queryFn: () => listDomains(gatewayId),
  })
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: vpnKeys.domains(gatewayId) })

  const add = useMutation({
    mutationFn: (domain: string) => createDomain({ gatewayId, domain }),
    onSuccess: () => {
      invalidate()
      setNewDomain('')
      toast.success('Đã thêm tên miền')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi thêm'),
  })
  const toggle = useMutation({
    mutationFn: (d: { id: number; enabled: boolean }) =>
      updateDomain(d.id, { enabled: d.enabled }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteDomain(id),
    onSuccess: () => {
      invalidate()
      toast.success('Đã xóa tên miền')
    },
  })

  const target = tailnetIp
    ? `PROXY ${tailnetIp}:${proxyPort}`
    : '(chờ agent báo IP)'

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <h4 className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
          Trang đi qua VPN
        </h4>
        <span className='font-mono text-xs text-muted-foreground'>
          → {target}
        </span>
      </div>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tên miền</TableHead>
              <TableHead className='w-20'>Bật</TableHead>
              <TableHead className='w-12'></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className='text-center text-sm text-muted-foreground'
                >
                  Chưa có tên miền
                </TableCell>
              </TableRow>
            ) : (
              domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className='font-mono text-sm'>
                    {d.domain}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={d.enabled}
                      onCheckedChange={(v) =>
                        toggle.mutate({ id: d.id, enabled: v })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size='icon'
                      variant='ghost'
                      onClick={() => remove.mutate(d.id)}
                    >
                      <Trash2 className='size-4 text-destructive' />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className='flex gap-2'>
        <Input
          className='font-mono'
          placeholder='them-ten-mien.bitel.com.pe'
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newDomain.trim())
              add.mutate(newDomain.trim())
          }}
        />
        <Button
          onClick={() => newDomain.trim() && add.mutate(newDomain.trim())}
          disabled={add.isPending || !newDomain.trim()}
        >
          <Plus className='size-4' /> Thêm
        </Button>
      </div>
    </div>
  )
}
