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
import {
  createDnsSplit,
  deleteDnsSplit,
  dnsSplitKeys,
  listDnsSplit,
  updateDnsSplit,
  type DnsSplitRule,
  type DnsSplitRuleInput,
} from './data/dns-split-api'

type Draft = DnsSplitRuleInput & { id?: number }

const EMPTY: Draft = {
  domain: '',
  nameservers: '',
  note: '',
  enabled: true,
}

export function DnsSplit() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: dnsSplitKeys.all, queryFn: listDnsSplit })

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: dnsSplitKeys.all })

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id != null
        ? updateDnsSplit(d.id, d)
        : createDnsSplit({
            domain: d.domain,
            nameservers: d.nameservers,
            note: d.note,
            enabled: d.enabled,
          }),
    onSuccess: () => {
      invalidate()
      setDraft(null)
      toast.success('Đã lưu split DNS')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi lưu'),
  })

  const toggle = useMutation({
    mutationFn: (row: DnsSplitRule) =>
      updateDnsSplit(row.id, { enabled: !row.enabled }),
    onSuccess: invalidate,
    onError: () => toast.error('Cập nhật thất bại'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteDnsSplit(id),
    onSuccess: () => {
      invalidate()
      toast.success('Đã xóa')
    },
  })

  function openNew() {
    setDraft({ ...EMPTY })
    setIsNew(true)
  }
  function openEdit(r: DnsSplitRule) {
    setDraft({
      id: r.id,
      domain: r.domain,
      nameservers: r.nameservers,
      note: r.note ?? '',
      enabled: r.enabled,
    })
    setIsNew(false)
  }

  function handleSave() {
    if (!draft) return
    if (!draft.domain.trim()) return toast.error('Domain không được trống')
    if (!draft.nameservers.trim())
      return toast.error('Nameservers không được trống')
    save.mutate(draft)
  }

  return (
    <div className='flex flex-1 flex-col gap-4'>
      <div className='flex items-start justify-between gap-4'>
        <p className='text-sm text-muted-foreground'>
          Domain nội bộ (vd <span className='font-mono'>bitel.com.pe</span>) hỏi
          thẳng nameserver nội bộ thay vì DNS công cộng — headscale tự đọc mỗi
          ~30s, không cần sửa config + restart.
        </p>
        <Button onClick={openNew}>
          <Plus className='size-4' /> Thêm domain
        </Button>
      </div>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được split-dns. Kiểm tra backend (/api/dns-split).
        </div>
      ) : isLoading ? (
        <div className='text-sm text-muted-foreground'>Đang tải…</div>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Nameservers</TableHead>
                <TableHead>Ghi chú</TableHead>
                <TableHead className='w-20 text-center'>Bật</TableHead>
                <TableHead className='w-24'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='text-center text-sm text-muted-foreground'
                  >
                    Chưa có domain nào — mọi DNS đi qua resolver công khai mặc
                    định.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='font-mono text-sm'>
                      {r.domain}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>
                      {r.nameservers}
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {r.note || '—'}
                    </TableCell>
                    <TableCell className='text-center'>
                      <Switch
                        checked={r.enabled}
                        disabled={toggle.isPending}
                        onCheckedChange={() => toggle.mutate(r)}
                      />
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
                          onClick={() => remove.mutate(r.id)}
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

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{isNew ? 'Thêm domain' : 'Sửa domain'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className='grid gap-3 py-1'>
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>Domain</Label>
                <Input
                  className='font-mono'
                  value={draft.domain}
                  placeholder='bitel.com.pe'
                  onChange={(e) =>
                    setDraft({ ...draft, domain: e.target.value })
                  }
                />
              </div>
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>
                  Nameservers (phân tách bằng dấu phẩy)
                </Label>
                <Input
                  className='font-mono'
                  value={draft.nameservers}
                  placeholder='10.121.127.193'
                  onChange={(e) =>
                    setDraft({ ...draft, nameservers: e.target.value })
                  }
                />
              </div>
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>
                  Ghi chú (tùy chọn)
                </Label>
                <Input
                  value={draft.note ?? ''}
                  placeholder='DC Peru dc01.viettelperu.com'
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                />
              </div>
              <div className='flex items-center justify-between rounded-md border p-3'>
                <div>
                  <p className='text-sm font-medium'>Bật</p>
                  <p className='text-xs text-muted-foreground'>
                    Tắt = tạm ngưng, không xóa cấu hình
                  </p>
                </div>
                <Switch
                  checked={draft.enabled ?? true}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
              </div>
              {isNew || (
                <Badge variant='secondary' className='w-fit'>
                  ID #{draft.id}
                </Badge>
              )}
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
    </div>
  )
}
