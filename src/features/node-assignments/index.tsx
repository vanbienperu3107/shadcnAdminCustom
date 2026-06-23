import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Map, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  fetchMachines,
  hsKeys,
  type HsMachine,
} from '@/features/headscale/hs-api'
import {
  assignmentKeys,
  deleteNodeAssignment,
  listNodeAssignments,
  setNodeAssignment,
  type NodeAssignmentGroup,
} from './data/assignments-api'

function truncateKey(key: string | undefined): string {
  if (!key) return '—'
  const parts = key.split(':')
  const hex = parts[parts.length - 1] ?? key
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`
}

type EditDialogProps = {
  machine: HsMachine
  current: number[]
  open: boolean
  onClose: () => void
}

function EditDialog({ machine, current, open, onClose }: EditDialogProps) {
  const qc = useQueryClient()
  const derps = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })
  const [selected, setSelected] = useState<number[]>(current)

  const mut = useMutation({
    mutationFn: () => setNodeAssignment(machine.nodeKey ?? '', selected),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentKeys.all })
      toast.success('Đã lưu node assignments')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggle = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const machineName = machine.givenName || machine.name || '—'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Gán DERP cho {machineName}</DialogTitle>
        </DialogHeader>
        <p className='font-mono text-xs text-muted-foreground'>
          nodeKey: {machine.nodeKey ?? '—'}
        </p>
        <div className='space-y-2 py-2'>
          {(derps.data ?? [])
            .filter((d) => !d.embedded)
            .map((d) => (
              <div key={d.regionId} className='flex items-center gap-2'>
                <Checkbox
                  id={`r-${d.regionId}`}
                  checked={selected.includes(d.regionId)}
                  onCheckedChange={() => toggle(d.regionId)}
                />
                <Label htmlFor={`r-${d.regionId}`} className='cursor-pointer'>
                  <span className='font-medium'>{d.name}</span>
                  <span className='ml-2 text-xs text-muted-foreground'>
                    {d.hostname}
                  </span>
                </Label>
              </div>
            ))}
        </div>
        <p className='text-xs text-muted-foreground'>
          Khi không chọn region nào, node sẽ nhận DERPMap mặc định từ headscale.
        </p>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Hủy
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !machine.nodeKey}
          >
            {mut.isPending && (
              <Loader2 className='me-1.5 size-3.5 animate-spin' />
            )}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NodeAssignments() {
  const qc = useQueryClient()
  const [editMachine, setEditMachine] = useState<HsMachine | null>(null)

  const machines = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
  })
  const assignments = useQuery({
    queryKey: assignmentKeys.all,
    queryFn: listNodeAssignments,
  })
  const derps = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })

  const deleteMut = useMutation({
    mutationFn: deleteNodeAssignment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: assignmentKeys.all })
      toast.success('Đã xóa node assignment')
    },
    onError: () => toast.error('Xóa thất bại'),
  })

  const assignmentMap = new Map<string, NodeAssignmentGroup>(
    (assignments.data ?? []).map((a) => [a.nodeKey, a])
  )

  const nodes = (machines.data?.nodes ?? []).filter((m) => m.nodeKey)
  const isLoading =
    machines.isLoading || assignments.isLoading || derps.isLoading

  const editCurrent = editMachine
    ? (assignmentMap
        .get(editMachine.nodeKey ?? '')
        ?.regions.map((r) => r.regionId) ?? [])
    : []

  return (
    <>
      <Header />
      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>
            <Map className='me-2 mb-0.5 inline size-6 text-blue-500' />
            Node Assignments
          </h2>
          <p className='text-muted-foreground'>
            Gán từng Tailscale node vào các DERP region cụ thể. headscale sẽ gửi
            DERPMap tùy chỉnh cho node đó thay vì DERPMap chung.
          </p>
        </div>

        {isLoading && (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        )}

        {!isLoading && nodes.length === 0 && (
          <p className='text-sm text-muted-foreground'>
            Không có machine nào có nodeKey. Kiểm tra kết nối Headscale API.
          </p>
        )}

        {nodes.length > 0 && (
          <div className='rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Node Key</TableHead>
                  <TableHead>DERP Regions</TableHead>
                  <TableHead className='text-end'>Sửa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((m) => {
                  const key = m.nodeKey!
                  const asgn = assignmentMap.get(key)
                  return (
                    <TableRow key={key}>
                      <TableCell className='font-medium'>
                        {m.givenName || m.name || '—'}
                        {m.online && (
                          <CheckCircle2 className='ms-1.5 inline size-3.5 text-emerald-500' />
                        )}
                      </TableCell>
                      <TableCell className='font-mono text-xs text-muted-foreground'>
                        {m.ipAddresses?.[0] ?? '—'}
                      </TableCell>
                      <TableCell
                        className='font-mono text-xs text-muted-foreground'
                        title={key}
                      >
                        {truncateKey(key)}
                      </TableCell>
                      <TableCell>
                        {asgn ? (
                          <div className='flex flex-wrap gap-1'>
                            {asgn.regions.map((r) => (
                              <Badge
                                key={r.regionId}
                                variant='secondary'
                                className='text-xs'
                              >
                                {r.code}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className='text-xs text-muted-foreground'>
                            mặc định (base map)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className='text-end'>
                        <div className='flex justify-end gap-1'>
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-7'
                            onClick={() => setEditMachine(m)}
                          >
                            <Pencil className='size-3.5' />
                          </Button>
                          {asgn && (
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-7 text-destructive'
                              disabled={deleteMut.isPending}
                              onClick={() => deleteMut.mutate(key)}
                            >
                              <Trash2 className='size-3.5' />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className='rounded-md border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground'>
          <p className='font-medium text-foreground'>Cách hoạt động:</p>
          <ul className='mt-1 list-inside list-disc space-y-0.5'>
            <li>
              headscale patch gọi{' '}
              <code className='font-mono text-foreground'>
                GET /api/internal/derp-map/:nodeKey
              </code>{' '}
              với <code className='font-mono'>X-Headscale-Secret</code> mỗi 30s
              để lấy DERPMap tùy chỉnh.
            </li>
            <li>
              Node không có assignment → nhận DERPMap mặc định (
              <em>headscale fallback</em>).
            </li>
            <li>
              Node có assignment → chỉ thấy các DERP region được chọn, ưu tiên
              theo priority và maintenance mode.
            </li>
            <li>
              Yêu cầu headscale image{' '}
              <code className='font-mono text-foreground'>
                ghcr.io/vanbienperu3107/headscale:0.27.1-pernode
              </code>{' '}
              và cấu hình{' '}
              <code className='font-mono'>derp.dashboard.enabled: true</code>{' '}
              trong <code className='font-mono'>config.yaml</code>.
            </li>
          </ul>
        </div>
      </Main>

      {editMachine && (
        <EditDialog
          machine={editMachine}
          current={editCurrent}
          open={!!editMachine}
          onClose={() => setEditMachine(null)}
        />
      )}
    </>
  )
}
