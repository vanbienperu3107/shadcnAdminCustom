import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Flame,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  clearForceRoutes,
  createForceRoute,
  deleteForceRoute,
  forceKeys,
  listForceRoutes,
  syncForceRoutes,
  type ForceRoute,
  type SyncResult,
} from './data/force-api'

function SyncOutput({ result }: { result: SyncResult | null }) {
  if (!result) return null
  return (
    <div
      className={`mt-3 rounded-md border p-3 font-mono text-xs ${
        result.ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
          : 'border-destructive/30 bg-destructive/5 text-destructive'
      }`}
    >
      {result.error && (
        <p className='mb-1 font-semibold'>Lỗi: {result.error}</p>
      )}
      {result.steps.map((s, i) => (
        <pre key={i} className='whitespace-pre-wrap'>
          {s}
        </pre>
      ))}
    </div>
  )
}

function AddRouteDialog({
  regionId,
  derpName,
}: {
  regionId: number
  derpName: string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [ip, setIp] = useState('')
  const [label, setLabel] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      createForceRoute({
        regionId,
        clientIp: ip.trim(),
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: forceKeys.all })
      setOpen(false)
      setIp('')
      setLabel('')
      toast.success('Đã thêm IP vào force routes')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm' variant='outline'>
          <Plus className='me-1.5 size-3.5' /> Thêm IP
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Thêm IP vào {derpName}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <Label>Client IP (Tailscale IP hoặc public IP)</Label>
            <Input
              placeholder='100.64.x.x'
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className='mt-1 font-mono'
            />
          </div>
          <div>
            <Label>Ghi chú (tùy chọn)</Label>
            <Input
              placeholder='votam-pc'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className='mt-1'
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Hủy
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!ip.trim() || mut.isPending}
          >
            {mut.isPending && (
              <Loader2 className='me-1.5 size-3.5 animate-spin' />
            )}
            Thêm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DerpGroup = {
  regionId: number
  code: string
  name: string
  hostname: string
  sshUser: string | null
  sshPort: number | null
  routes: ForceRoute[]
}

export function ForceRoutes() {
  const qc = useQueryClient()
  const [syncResults, setSyncResults] = useState<Record<number, SyncResult>>({})

  const routes = useQuery({ queryKey: forceKeys.all, queryFn: listForceRoutes })
  const derps = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })

  // Group routes by DERP region
  const groups: DerpGroup[] = (derps.data ?? [])
    .filter((d) => !d.embedded)
    .map((d) => ({
      regionId: d.regionId,
      code: d.code,
      name: d.name,
      hostname: d.hostname,
      sshUser: d.sshUser ?? 'root',
      sshPort: d.sshPort ?? 22,
      routes: (routes.data ?? []).filter((r) => r.regionId === d.regionId),
    }))

  const deleteMut = useMutation({
    mutationFn: deleteForceRoute,
    onSuccess: () => qc.invalidateQueries({ queryKey: forceKeys.all }),
    onError: () => toast.error('Xóa thất bại'),
  })

  const syncMut = useMutation({
    mutationFn: syncForceRoutes,
    onSuccess: (result, regionId) => {
      setSyncResults((prev) => ({ ...prev, [regionId]: result }))
      toast[result.ok ? 'success' : 'error'](
        result.ok
          ? 'Sync iptables thành công'
          : `Sync thất bại: ${result.error}`
      )
    },
    onError: (e: Error, regionId) => {
      setSyncResults((prev) => ({
        ...prev,
        [regionId]: { ok: false, steps: [], error: e.message },
      }))
      toast.error(e.message)
    },
  })

  const clearMut = useMutation({
    mutationFn: clearForceRoutes,
    onSuccess: (result, regionId) => {
      setSyncResults((prev) => ({ ...prev, [regionId]: result }))
      toast[result.ok ? 'success' : 'error'](
        result.ok
          ? 'Đã xóa DERP-FORCE chain'
          : `Clear thất bại: ${result.error}`
      )
    },
    onError: (e: Error, regionId) => {
      setSyncResults((prev) => ({
        ...prev,
        [regionId]: { ok: false, steps: [], error: e.message },
      }))
      toast.error(e.message)
    },
  })

  return (
    <>
      <Header />
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            <Flame className='me-2 mb-0.5 inline size-6 text-orange-500' />
            Firewall Force Routes
          </h2>
          <p className='text-muted-foreground'>
            Quản lý iptables DERP-FORCE chain trên từng node. Client IP trong
            danh sách sẽ được ACCEPT vào chain riêng — ép traffic qua DERP chỉ
            định.
          </p>
        </div>

        {(routes.isLoading || derps.isLoading) && (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        )}

        {groups.map((g) => (
          <div key={g.regionId} className='rounded-lg border'>
            {/* Header */}
            <div className='flex flex-wrap items-center justify-between gap-2 border-b p-4'>
              <div>
                <span className='font-semibold'>{g.name}</span>
                <span className='ms-2 text-xs text-muted-foreground'>
                  {g.hostname} · SSH {g.sshUser}@{g.hostname}:{g.sshPort}
                </span>
                <Badge variant='secondary' className='ms-2'>
                  {g.routes.length} IP
                </Badge>
              </div>
              <div className='flex gap-2'>
                <AddRouteDialog regionId={g.regionId} derpName={g.name} />
                <Button
                  size='sm'
                  variant='outline'
                  disabled={syncMut.isPending}
                  onClick={() => syncMut.mutate(g.regionId)}
                >
                  {syncMut.isPending && syncMut.variables === g.regionId ? (
                    <Loader2 className='me-1.5 size-3.5 animate-spin' />
                  ) : (
                    <RefreshCw className='me-1.5 size-3.5' />
                  )}
                  Sync iptables
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-destructive'
                  disabled={clearMut.isPending}
                  onClick={() => clearMut.mutate(g.regionId)}
                >
                  Clear chain
                </Button>
              </div>
            </div>

            {/* Route table */}
            {g.routes.length === 0 ? (
              <p className='p-4 text-sm text-muted-foreground'>
                Chưa có IP nào. Thêm IP để bắt đầu quản lý firewall.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client IP</TableHead>
                    <TableHead>Ghi chú</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className='text-end'>Xóa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.routes.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className='font-mono text-sm'>
                        {r.clientIp}
                      </TableCell>
                      <TableCell className='text-muted-foreground'>
                        {r.label ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.active ? (
                          <span className='inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400'>
                            <CheckCircle2 className='size-3.5' /> Active
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                            <XCircle className='size-3.5' /> Inactive
                          </span>
                        )}
                      </TableCell>
                      <TableCell className='text-end'>
                        <Button
                          size='icon'
                          variant='ghost'
                          className='size-7 text-destructive'
                          disabled={deleteMut.isPending}
                          onClick={() => deleteMut.mutate(r.id)}
                        >
                          <Trash2 className='size-3.5' />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Sync output */}
            {syncResults[g.regionId] && (
              <div className='border-t p-4'>
                <p className='mb-1 text-xs font-medium text-muted-foreground'>
                  Kết quả sync:
                </p>
                <SyncOutput result={syncResults[g.regionId]} />
              </div>
            )}
          </div>
        ))}

        <div className='rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground'>
          <p className='font-medium text-foreground'>Lưu ý:</p>
          <ul className='mt-1 list-inside list-disc space-y-0.5'>
            <li>
              Cần cấu hình{' '}
              <code className='font-mono text-foreground'>
                DERP_SSH_PRIVATE_KEY
              </code>{' '}
              trong env và SSH public key trong{' '}
              <code className='font-mono'>~/.ssh/authorized_keys</code> trên
              từng DERP VPS.
            </li>
            <li>
              SSH user cần quyền chạy{' '}
              <code className='font-mono'>iptables</code> (root hoặc sudo
              NOPASSWD).
            </li>
            <li>
              Chain <code className='font-mono'>DERP-FORCE</code> chỉ ACCEPT —
              không DROP client ngoài danh sách. Để chặn, thay đổi default
              policy INPUT thành DROP trên VPS.
            </li>
            <li>
              <code className='font-mono'>Sync iptables</code> = áp dụng lại
              toàn bộ danh sách active.{' '}
              <code className='font-mono'>Clear chain</code> = xóa chain khỏi
              VPS.
            </li>
          </ul>
        </div>
      </Main>
    </>
  )
}
