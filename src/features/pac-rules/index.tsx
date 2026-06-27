import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  createPacRule,
  deletePacRule,
  listPacRules,
  pacRuleKeys,
  previewPac,
  togglePacRule,
  updatePacRule,
  type PacRuleInput,
} from './data/pac-rules-api'

type Draft = PacRuleInput & { id?: number }

const EMPTY: Draft = {
  scope: 'global',
  mac: '',
  kind: 'domain',
  pattern: '',
  proxyTarget: 'PROXY 127.0.0.1:18888',
  priority: 100,
  enabled: true,
}

export function PacRulesPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const {
    data: rows = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: pacRuleKeys.all, queryFn: listPacRules })

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: pacRuleKeys.all })

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updatePacRule(d.id, d)
        : createPacRule({
            scope: d.scope,
            mac: d.scope === 'node' ? d.mac : null,
            kind: d.kind,
            pattern: d.pattern,
            proxyTarget: d.proxyTarget,
            priority: d.priority,
            enabled: d.enabled,
          }),
    onSuccess: () => {
      invalidate()
      setDraft(null)
      toast.success('Đã lưu rule')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi lưu'),
  })

  const toggle = useMutation({
    mutationFn: (id: number) => togglePacRule(id),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) => deletePacRule(id),
    onSuccess: () => {
      invalidate()
      toast.success('Đã xóa rule')
    },
  })
  const doPreview = useMutation({
    mutationFn: () => previewPac(),
    onSuccess: (txt) => setPreview(txt),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi preview'),
  })

  function handleSave() {
    if (!draft) return
    if (!draft.pattern.trim()) return toast.error('Pattern không được trống')
    if (!draft.proxyTarget.trim())
      return toast.error('Proxy target không được trống')
    save.mutate(draft)
  }

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>PAC Rules</h2>
          <p className='text-muted-foreground'>
            Luật PAC động — render thành{' '}
            <span className='font-mono'>/api/client/pac</span>. Client tự cập
            nhật mỗi 30s.
          </p>
        </div>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            onClick={() => doPreview.mutate()}
            disabled={doPreview.isPending}
          >
            <Eye className='size-4' /> Xem trước PAC
          </Button>
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus className='size-4' /> Thêm rule
          </Button>
        </div>
      </div>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được pac-rules. Kiểm tra backend (/api/pac-rules).
        </div>
      ) : isLoading ? (
        <div className='text-sm text-muted-foreground'>Đang tải…</div>
      ) : (
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-24'>Scope</TableHead>
                <TableHead className='w-24'>Kind</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Proxy target</TableHead>
                <TableHead className='w-24'>Priority</TableHead>
                <TableHead className='w-20'>Bật</TableHead>
                <TableHead className='w-24'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='text-center text-sm text-muted-foreground'
                  >
                    Chưa có rule
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge
                        variant={r.scope === 'node' ? 'default' : 'secondary'}
                      >
                        {r.scope}
                        {r.scope === 'node' && r.mac ? ` · ${r.mac}` : ''}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-sm'>{r.kind}</TableCell>
                    <TableCell className='font-mono text-sm'>
                      {r.pattern}
                    </TableCell>
                    <TableCell className='font-mono text-sm text-muted-foreground'>
                      {r.proxyTarget}
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {r.priority}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={() => toggle.mutate(r.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className='flex gap-1'>
                        <Button
                          size='icon'
                          variant='ghost'
                          onClick={() =>
                            setDraft({
                              id: r.id,
                              scope: r.scope,
                              mac: r.mac ?? '',
                              kind: r.kind,
                              pattern: r.pattern,
                              proxyTarget: r.proxyTarget,
                              priority: r.priority,
                              enabled: r.enabled,
                            })
                          }
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

      {/* Add / Edit dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Sửa rule' : 'Thêm rule'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className='grid gap-3 py-1'>
              <div className='grid grid-cols-2 gap-3'>
                <div className='grid gap-1.5'>
                  <Label className='text-xs text-muted-foreground'>Scope</Label>
                  <Select
                    value={draft.scope}
                    onValueChange={(v) =>
                      setDraft({ ...draft, scope: v as 'global' | 'node' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='global'>global</SelectItem>
                      <SelectItem value='node'>node</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5'>
                  <Label className='text-xs text-muted-foreground'>Kind</Label>
                  <Select
                    value={draft.kind}
                    onValueChange={(v) =>
                      setDraft({ ...draft, kind: v as 'domain' | 'subnet' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='domain'>domain</SelectItem>
                      <SelectItem value='subnet'>subnet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {draft.scope === 'node' && (
                <div className='grid gap-1.5'>
                  <Label className='text-xs text-muted-foreground'>
                    MAC (node)
                  </Label>
                  <Input
                    className='font-mono'
                    value={draft.mac ?? ''}
                    placeholder='AA:BB:CC:11:22:33'
                    onChange={(e) =>
                      setDraft({ ...draft, mac: e.target.value })
                    }
                  />
                </div>
              )}
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>
                  Pattern{' '}
                  {draft.kind === 'subnet'
                    ? '(CIDR vd 10.0.0.0/8)'
                    : '(domain)'}
                </Label>
                <Input
                  className='font-mono'
                  value={draft.pattern}
                  placeholder={
                    draft.kind === 'subnet' ? '10.0.0.0/8' : 'bitel.com.pe'
                  }
                  onChange={(e) =>
                    setDraft({ ...draft, pattern: e.target.value })
                  }
                />
              </div>
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>
                  Proxy target
                </Label>
                <Input
                  className='font-mono'
                  value={draft.proxyTarget}
                  placeholder='PROXY 127.0.0.1:18888'
                  onChange={(e) =>
                    setDraft({ ...draft, proxyTarget: e.target.value })
                  }
                />
              </div>
              <div className='grid gap-1.5'>
                <Label className='text-xs text-muted-foreground'>
                  Priority
                </Label>
                <Input
                  value={draft.priority?.toString() ?? '100'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      priority: Number(e.target.value) || 100,
                    })
                  }
                />
              </div>
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

      {/* Preview PAC dialog */}
      <Dialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>PAC đã render (global)</DialogTitle>
          </DialogHeader>
          <pre className='max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs'>
            {preview}
          </pre>
        </DialogContent>
      </Dialog>
    </Main>
  )
}
