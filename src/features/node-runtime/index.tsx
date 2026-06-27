import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import {
  deleteNodeRuntime,
  listNodeRuntime,
  nodeRuntimeKeys,
  upsertNodeRuntime,
  type NodeRuntime,
  type NodeRuntimeInput,
} from './data/node-runtime-api'

type Draft = NodeRuntimeInput & { mac: string }

const EMPTY: Draft = {
  mac: '',
  hostname: '',
  mode: '',
  loginServer: '',
  alwaysUseDerp: true,
  derpKeepaliveSecs: 25,
  peerHttpProxy: '7655',
  socksAddr: '127.0.0.1:7654',
  advertiseRoutes: '',
  lanRoutes: '10.0.0.0/8',
  pacServerPort: 7658,
}

function toNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function NodeRuntimePage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: nodeRuntimeKeys.all, queryFn: listNodeRuntime })

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: nodeRuntimeKeys.all })

  const save = useMutation({
    mutationFn: ({ mac, body }: { mac: string; body: NodeRuntimeInput }) =>
      upsertNodeRuntime(mac, body),
    onSuccess: () => {
      invalidate()
      setDraft(null)
      toast.success('Đã lưu node runtime')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi lưu'),
  })

  const remove = useMutation({
    mutationFn: (mac: string) => deleteNodeRuntime(mac),
    onSuccess: () => {
      invalidate()
      toast.success('Đã xóa override')
    },
  })

  function openNew() {
    setDraft({ ...EMPTY })
    setIsNew(true)
  }
  function openEdit(r: NodeRuntime) {
    setDraft({
      mac: r.mac,
      hostname: r.hostname ?? '',
      mode: r.mode ?? '',
      loginServer: r.loginServer ?? '',
      alwaysUseDerp: r.alwaysUseDerp,
      derpKeepaliveSecs: r.derpKeepaliveSecs,
      peerHttpProxy: r.peerHttpProxy ?? '',
      socksAddr: r.socksAddr ?? '',
      advertiseRoutes: r.advertiseRoutes ?? '',
      lanRoutes: r.lanRoutes ?? '',
      pacServerPort: r.pacServerPort,
    })
    setIsNew(false)
  }

  function handleSave() {
    if (!draft) return
    if (!draft.mac.trim()) {
      toast.error('MAC không được trống')
      return
    }
    const { mac, ...body } = draft
    save.mutate({ mac: mac.trim(), body })
  }

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            Node Runtime Config
          </h2>
          <p className='text-muted-foreground'>
            Cấu hình runtime per-node (theo MAC). Node không có dòng → dùng
            global/default. Tắt <span className='font-mono'>Ép DERP</span> = cho
            phép UDP/direct.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className='size-4' /> Thêm node
        </Button>
      </div>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được node-runtime. Kiểm tra backend (/api/node-runtime).
        </div>
      ) : isLoading ? (
        <div className='text-sm text-muted-foreground'>Đang tải…</div>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-52'>MAC</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead className='w-24'>Mode</TableHead>
                <TableHead className='w-48'>UDP / DERP</TableHead>
                <TableHead className='w-36'>HTTP / SOCKS</TableHead>
                <TableHead className='w-24'>Keepalive</TableHead>
                <TableHead className='w-20'>PAC</TableHead>
                <TableHead className='w-24'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className='text-center text-sm text-muted-foreground'
                  >
                    Chưa có node override — mọi node dùng default.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.mac}>
                    <TableCell className='font-mono text-sm'>{r.mac}</TableCell>
                    <TableCell>{r.hostname ?? '—'}</TableCell>
                    <TableCell>
                      {r.mode ? (
                        <Badge variant='secondary'>{r.mode}</Badge>
                      ) : (
                        <span className='text-muted-foreground'>— auto</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Switch
                          checked={r.alwaysUseDerp ?? true}
                          onCheckedChange={(v) =>
                            save.mutate({
                              mac: r.mac,
                              body: { alwaysUseDerp: v },
                            })
                          }
                        />
                        <span className='text-sm'>
                          {(r.alwaysUseDerp ?? true) ? (
                            <span className='font-medium'>Ép DERP</span>
                          ) : (
                            <span className='text-emerald-600 dark:text-emerald-400'>
                              Cho UDP/direct
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {r.peerHttpProxy ?? '7655'} / {r.socksAddr ?? '…'}
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {r.derpKeepaliveSecs ?? 25}s
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {r.pacServerPort ?? 7658}
                    </TableCell>
                    <TableCell>
                      <div className='flex gap-1'>
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() => remove.mutate(r.mac)}
                        >
                          <Trash2 className='size-4 text-destructive' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {isNew ? 'Thêm node' : 'Sửa node'}
              {draft?.hostname ? ` — ${draft.hostname}` : ''}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className='grid gap-3 py-1'>
              <Field label='MAC'>
                <Input
                  className='font-mono'
                  value={draft.mac}
                  disabled={!isNew}
                  placeholder='AA:BB:CC:11:22:33'
                  onChange={(e) => setDraft({ ...draft, mac: e.target.value })}
                />
              </Field>
              <Field label='Hostname'>
                <Input
                  value={draft.hostname ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, hostname: e.target.value })
                  }
                />
              </Field>
              <Field label='Mode'>
                <Input
                  value={draft.mode ?? ''}
                  placeholder='itop | votam | (trống = auto)'
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
                />
              </Field>
              <div className='flex items-center justify-between rounded-md border p-3'>
                <div>
                  <p className='text-sm font-medium'>
                    Ép DERP (always_use_derp)
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    TẮT = cho phép UDP/direct (giảm latency)
                  </p>
                </div>
                <Switch
                  checked={draft.alwaysUseDerp ?? true}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, alwaysUseDerp: v })
                  }
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <Field label='HTTP proxy port'>
                  <Input
                    value={draft.peerHttpProxy ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, peerHttpProxy: e.target.value })
                    }
                  />
                </Field>
                <Field label='SOCKS addr'>
                  <Input
                    value={draft.socksAddr ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, socksAddr: e.target.value })
                    }
                  />
                </Field>
                <Field label='DERP keepalive (s)'>
                  <Input
                    value={draft.derpKeepaliveSecs?.toString() ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        derpKeepaliveSecs: toNum(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label='PAC server port'>
                  <Input
                    value={draft.pacServerPort?.toString() ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        pacServerPort: toNum(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label='Advertise routes'>
                <Input
                  value={draft.advertiseRoutes ?? ''}
                  placeholder='(trống)'
                  onChange={(e) =>
                    setDraft({ ...draft, advertiseRoutes: e.target.value })
                  }
                />
              </Field>
              <Field label='LAN routes'>
                <Input
                  value={draft.lanRoutes ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, lanRoutes: e.target.value })
                  }
                />
              </Field>
              <Field label='Login server'>
                <Input
                  value={draft.loginServer ?? ''}
                  placeholder='https://vpn2.hangocthanh.io.vn'
                  onChange={(e) =>
                    setDraft({ ...draft, loginServer: e.target.value })
                  }
                />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setDraft(null)}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Main>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='grid gap-1.5'>
      <Label className='text-xs text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}
