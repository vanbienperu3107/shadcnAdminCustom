import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeCheck,
  Ban,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Trash2,
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
import {
  approveEnrollment,
  deleteEnrollment,
  enrollKeys,
  fetchEnrollments,
  maskSalt,
  preApproveEnrollment,
  resetEnrollmentToken,
  revokeEnrollment,
  type Enrollment,
} from '@/features/enrollment/enroll-api'
import { ErrorBox } from '@/features/machines'

function StatusBadge({ status }: { status: Enrollment['status'] }) {
  if (status === 'approved')
    return (
      <Badge className='border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'>
        Đã duyệt
      </Badge>
    )
  if (status === 'revoked')
    return (
      <Badge
        variant='outline'
        className='border-destructive/40 text-destructive'
      >
        Đã thu hồi
      </Badge>
    )
  return (
    <Badge className='border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'>
      Chờ duyệt
    </Badge>
  )
}

/** Ô salt: mask mặc định, bấm mắt mới hiện (serial suy ra được machine key). */
function SaltCell({ salt }: { salt: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className='flex items-center gap-1'>
      <code className='font-mono text-xs'>
        {show ? salt : maskSalt(salt)}
      </code>
      <Button
        size='icon'
        variant='ghost'
        className='h-6 w-6 shrink-0'
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ẩn serial' : 'Hiện serial'}
      >
        {show ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
      </Button>
    </div>
  )
}

function ApproveDialog({
  row,
  onClose,
}: {
  row: Enrollment | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [pinnedIpv4, setPinnedIpv4] = useState('')
  const [note, setNote] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      approveEnrollment(row!.id, {
        ...(pinnedIpv4.trim() ? { pinnedIpv4: pinnedIpv4.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Đã duyệt thiết bị')
      void qc.invalidateQueries({ queryKey: enrollKeys.list })
      onClose()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duyệt thiết bị</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <p className='text-sm text-muted-foreground'>
            Máy <span className='font-medium'>{row?.hostname || row?.mac}</span>{' '}
            sẽ tự vào tailnet ở lần thử tiếp theo (tối đa 5 phút).
          </p>
          <div className='space-y-2'>
            <Label>IP ghim (tuỳ chọn)</Label>
            <Input
              placeholder='100.64.0.19'
              value={pinnedIpv4}
              onChange={(e) => setPinnedIpv4(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>Ghi chú</Label>
            <Input
              placeholder='vd: máy kế toán tầng 2'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={mut.isPending}>
            Huỷ
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Đang duyệt…' : 'Duyệt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreApproveDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [mac, setMac] = useState('')
  const [salt, setSalt] = useState('')
  const [note, setNote] = useState('')
  const [pinnedIpv4, setPinnedIpv4] = useState('')

  const mut = useMutation({
    mutationFn: () =>
      preApproveEnrollment({
        mac: mac.trim(),
        salt: salt.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(pinnedIpv4.trim() ? { pinnedIpv4: pinnedIpv4.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Đã duyệt trước thiết bị')
      void qc.invalidateQueries({ queryKey: enrollKeys.list })
      setMac('')
      setSalt('')
      setNote('')
      setPinnedIpv4('')
      onClose()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duyệt trước (pre-approve)</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <p className='text-sm text-muted-foreground'>
            Chạy <code className='rounded bg-muted px-1'>{'<exe> id'}</code> trên
            máy để lấy <code>mac</code> và <code>salt</code>, dán vào đây trước
            khi cắm máy — máy bật lên là vào tailnet ngay, không phải chờ duyệt.
          </p>
          <div className='space-y-2'>
            <Label>MAC</Label>
            <Input
              placeholder='f8:cf:00:11:22:33'
              value={mac}
              onChange={(e) => setMac(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>Salt (serial ổ đĩa)</Label>
            <Input
              placeholder='WD-WCC4E5PZ'
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>IP ghim (tuỳ chọn)</Label>
            <Input
              placeholder='100.64.0.19'
              value={pinnedIpv4}
              onChange={(e) => setPinnedIpv4(e.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>Ghi chú</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={mut.isPending}>
            Huỷ
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !mac.trim() || !salt.trim()}
          >
            {mut.isPending ? 'Đang lưu…' : 'Duyệt trước'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Tab "Enrollment": duyệt máy mới tự báo danh (zero-touch). */
export function EnrollmentPage() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: enrollKeys.list, queryFn: fetchEnrollments })
  const [approving, setApproving] = useState<Enrollment | null>(null)
  const [preOpen, setPreOpen] = useState(false)

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: enrollKeys.list })

  const revokeMut = useMutation({
    mutationFn: revokeEnrollment,
    onSuccess: () => {
      toast.success('Đã thu hồi')
      invalidate()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })
  const resetMut = useMutation({
    mutationFn: resetEnrollmentToken,
    onSuccess: () => {
      toast.success('Đã reset device token — máy có thể enroll lại')
      invalidate()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })
  const deleteMut = useMutation({
    mutationFn: deleteEnrollment,
    onSuccess: () => {
      toast.success('Đã xoá bản ghi')
      invalidate()
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const rows = q.data ?? []
  const pending = rows.filter((r) => r.status === 'pending').length
  const busy = revokeMut.isPending || resetMut.isPending || deleteMut.isPending

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between gap-3'>
        <div className='space-y-1'>
          <p className='text-sm text-muted-foreground'>
            Máy cài sẵn <code className='rounded bg-muted px-1'>node.xml</code>{' '}
            với <code>autologin=true</code> sẽ tự báo danh về đây. Duyệt xong máy
            tự vào tailnet, không cần thao tác trên máy.
          </p>
          {pending > 0 && (
            <Badge className='border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'>
              {pending} máy chờ duyệt
            </Badge>
          )}
        </div>
        <Button size='sm' onClick={() => setPreOpen(true)}>
          <Plus className='mr-2 h-4 w-4' />
          Duyệt trước
        </Button>
      </div>

      {q.isError ? (
        <ErrorBox />
      ) : q.isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máy</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Salt (serial)</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>IP ghim</TableHead>
                <TableHead>Enroll gần nhất</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='h-16 text-center text-muted-foreground'
                  >
                    Chưa có máy nào báo danh.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className='font-medium'>{r.note || r.hostname || '—'}</div>
                      {r.note && r.hostname && (
                        <div className='text-xs text-muted-foreground'>
                          {r.hostname}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>{r.mac}</TableCell>
                    <TableCell>
                      <SaltCell salt={r.salt} />
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap items-center gap-1'>
                        <StatusBadge status={r.status} />
                        {r.claimed && (
                          <Badge variant='outline' title='Đã có thiết bị giữ device token'>
                            Đã claim
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {r.pinnedIpv4 || '—'}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {r.lastEnrollAt
                        ? new Date(r.lastEnrollAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        {r.status !== 'approved' && (
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-8 gap-1 text-xs'
                            disabled={busy}
                            onClick={() => setApproving(r)}
                          >
                            <BadgeCheck className='h-3.5 w-3.5' />
                            Duyệt
                          </Button>
                        )}
                        {r.status === 'approved' && (
                          <>
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-8 gap-1 text-xs'
                              disabled={busy || !r.claimed}
                              title='Máy mất node.xml → cho phép claim lại'
                              onClick={() => {
                                if (window.confirm('Reset device token của máy này?'))
                                  resetMut.mutate(r.id)
                              }}
                            >
                              <KeyRound className='h-3.5 w-3.5' />
                              Reset token
                            </Button>
                            <Button
                              size='sm'
                              variant='ghost'
                              className='h-8 gap-1 text-xs text-destructive hover:text-destructive'
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm('Thu hồi quyền vào tailnet của máy này?'))
                                  revokeMut.mutate(r.id)
                              }}
                            >
                              <Ban className='h-3.5 w-3.5' />
                              Thu hồi
                            </Button>
                          </>
                        )}
                        <Button
                          size='sm'
                          variant='ghost'
                          className='h-8 gap-1 text-xs text-destructive hover:text-destructive'
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm('Xoá hẳn bản ghi enrollment này?'))
                              deleteMut.mutate(r.id)
                          }}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                          Xoá
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

      <ApproveDialog row={approving} onClose={() => setApproving(null)} />
      <PreApproveDialog open={preOpen} onClose={() => setPreOpen(false)} />
    </div>
  )
}
