import { type ReactNode, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Folder,
  FolderOpen,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
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
import {
  listOnlineDevices,
  type OnlineDevice,
} from '@/features/node-runtime/data/node-runtime-api'
import {
  createFolderShare,
  deleteFolderShare,
  folderShareKeys,
  getBrowse,
  listFolderShares,
  requestBrowse,
  setFolderAccess,
  updateFolderShare,
  type AccessInput,
  type BrowseEntry,
  type FolderShare,
  type FolderShareInput,
} from './data/folder-shares-api'

type Draft = FolderShareInput & { id?: number }

const EMPTY: Draft = {
  ownerMac: '',
  ownerHostname: '',
  shareName: '',
  localPath: '',
  enabled: true,
}

export function FolderSharesPage() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [accessDraft, setAccessDraft] = useState<AccessInput[]>([])
  const [isNew, setIsNew] = useState(false)
  const [browseFor, setBrowseFor] = useState<{
    mac: string
    label: string
  } | null>(null)

  const {
    data: shares = [],
    isLoading,
    isError,
  } = useQuery({ queryKey: folderShareKeys.all, queryFn: listFolderShares })

  // Máy đang online (report metrics 5' gần nhất) — nguồn chọn owner/grantee
  // thay vì gõ tay MAC, và cũng là danh sách "PC được truy cập" cho ma trận.
  const online = useQuery({
    queryKey: ['folder-shares', 'online-devices'],
    queryFn: listOnlineDevices,
    enabled: false,
  })

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: folderShareKeys.all })

  const grouped = useMemo(() => {
    const byOwner = new Map<
      string,
      { hostname: string | null; shares: FolderShare[] }
    >()
    for (const s of shares) {
      const key = s.ownerMac
      if (!byOwner.has(key))
        byOwner.set(key, { hostname: s.ownerHostname, shares: [] })
      byOwner.get(key)!.shares.push(s)
    }
    return [...byOwner.entries()].sort((a, b) =>
      (a[1].hostname ?? a[0]).localeCompare(b[1].hostname ?? b[0])
    )
  }, [shares])

  // Không setDraft(null) ở đây — nếu đóng ngay, khi handleSave còn phải lưu
  // tiếp access-matrix (saveAccess) mà lưu đó fail thì dialog đã mất, admin
  // không còn cách nào biết/thử lại. Đóng dialog do handleSave quyết định,
  // sau khi CẢ hai bước xong (hoặc ngay nếu không có access nào cần lưu).
  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updateFolderShare(d.id, d)
        : createFolderShare(d as FolderShareInput),
    onSuccess: () => {
      invalidate()
      toast.success('Đã lưu thư mục chia sẻ')
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Lỗi lưu'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteFolderShare(id),
    onSuccess: () => {
      invalidate()
      toast.success('Đã xóa thư mục chia sẻ')
    },
  })

  const saveAccess = useMutation({
    mutationFn: ({ id, access }: { id: number; access: AccessInput[] }) =>
      setFolderAccess(id, access),
    onSuccess: () => {
      invalidate()
      toast.success('Đã lưu phân quyền — client sẽ áp dụng trong ít giây')
    },
    onError: () => toast.error('Lưu phân quyền thất bại'),
  })

  function openNew() {
    setDraft({ ...EMPTY })
    setAccessDraft([])
    setIsNew(true)
    void online.refetch()
  }

  function openEdit(s: FolderShare) {
    setDraft({
      id: s.id,
      ownerMac: s.ownerMac,
      ownerHostname: s.ownerHostname,
      shareName: s.shareName,
      localPath: s.localPath,
      enabled: s.enabled,
    })
    setAccessDraft(
      s.access.map((a) => ({
        granteeMac: a.granteeMac,
        granteeHostname: a.granteeHostname,
        access: a.access,
        autoMount: a.autoMount,
        mountDrive: a.mountDrive,
        enabled: a.enabled,
      }))
    )
    setIsNew(false)
    void online.refetch()
  }

  function pickOwner(d: OnlineDevice) {
    setDraft((prev) =>
      prev ? { ...prev, ownerMac: d.mac, ownerHostname: d.hostname } : prev
    )
  }

  function handleSave() {
    if (!draft) return
    if (
      !draft.ownerMac.trim() ||
      !draft.shareName.trim() ||
      !draft.localPath.trim()
    ) {
      toast.error('Cần chọn PC, tên chia sẻ và đường dẫn')
      return
    }
    save.mutate(draft, {
      onSuccess: (row) => {
        if (accessDraft.length === 0) {
          setDraft(null)
          return
        }
        // Chuyển draft sang "đang sửa" (id đã có, isNew=false) TRƯỚC khi lưu
        // access-matrix — nếu bước này fail và admin bấm lưu lại từ cùng
        // dialog, handleSave phải đi qua nhánh update (draft.id đã set), chứ
        // không lặp lại create (sẽ vi phạm UNIQUE(owner_mac, share_name) vì
        // dòng đã được tạo ở lần thử trước, khiến MỌI lần retry đều lỗi).
        setDraft((d) => (d ? { ...d, id: row.id } : d))
        setIsNew(false)
        saveAccess.mutate(
          { id: row.id, access: accessDraft },
          {
            // Chỉ đóng dialog khi CẢ hai bước thành công — lưu access thất
            // bại thì giữ dialog mở để admin bấm "Lưu & áp dụng" lại (thay vì
            // phải nhập lại toàn bộ ma trận từ đầu).
            onSuccess: () => setDraft(null),
          }
        )
      },
    })
  }

  function toggleGrantee(d: OnlineDevice, checked: boolean) {
    setAccessDraft((prev) => {
      if (!checked) return prev.filter((a) => a.granteeMac !== d.mac)
      if (prev.some((a) => a.granteeMac === d.mac)) return prev
      return [
        ...prev,
        {
          granteeMac: d.mac,
          granteeHostname: d.hostname,
          access: 'rw',
          autoMount: false,
          mountDrive: null,
          enabled: true,
        },
      ]
    })
  }

  function patchGrantee(mac: string, patch: Partial<AccessInput>) {
    setAccessDraft((prev) =>
      prev.map((a) => (a.granteeMac === mac ? { ...a, ...patch } : a))
    )
  }

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between gap-4'>
        <p className='text-sm text-muted-foreground'>
          Chia sẻ thư mục qua Taildrive theo từng PC. Chọn máy chia sẻ, thư mục,
          rồi chọn PC nào được truy cập, quyền gì và có tự động mount ổ đĩa hay
          không.
        </p>
        <Button onClick={openNew}>
          <Plus className='size-4' /> Thêm thư mục chia sẻ
        </Button>
      </div>

      {isError ? (
        <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
          Không tải được danh sách chia sẻ. Kiểm tra backend
          (/api/folder-shares).
        </div>
      ) : isLoading ? (
        <div className='text-sm text-muted-foreground'>Đang tải…</div>
      ) : grouped.length === 0 ? (
        <div className='rounded-md border p-6 text-center text-sm text-muted-foreground'>
          Chưa có PC nào chia sẻ thư mục.
        </div>
      ) : (
        <div className='flex flex-col gap-4'>
          {grouped.map(([mac, g]) => (
            <div key={mac} className='rounded-md border'>
              <div className='flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5'>
                <FolderTree className='size-4 text-muted-foreground' />
                <span className='font-medium'>{g.hostname ?? mac}</span>
                <span className='font-mono text-xs text-muted-foreground'>
                  {mac}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thư mục</TableHead>
                    <TableHead>Đường dẫn</TableHead>
                    <TableHead>Được truy cập bởi</TableHead>
                    <TableHead className='w-20'>Bật</TableHead>
                    <TableHead className='w-24'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.shares.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className='font-mono text-sm'>
                        {s.shareName}
                      </TableCell>
                      <TableCell className='font-mono text-xs text-muted-foreground'>
                        {s.localPath}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {s.access.length === 0 ? (
                            <span className='text-xs text-muted-foreground'>
                              — chưa cấp —
                            </span>
                          ) : (
                            s.access.map((a) => (
                              <Badge
                                key={a.id}
                                variant={a.enabled ? 'secondary' : 'outline'}
                                className='gap-1'
                              >
                                {a.granteeHostname ?? a.granteeMac}
                                <span className='font-mono text-[10px] opacity-70'>
                                  {a.access.toUpperCase()}
                                </span>
                                {a.autoMount && a.mountDrive && (
                                  <span className='font-mono text-[10px] opacity-70'>
                                    {a.mountDrive}
                                  </span>
                                )}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={s.enabled}
                          onCheckedChange={(v) =>
                            save.mutate({ ...s, id: s.id, enabled: v })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className='flex gap-1'>
                          <Button
                            size='icon'
                            variant='ghost'
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className='size-4' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            onClick={() => remove.mutate(s.id)}
                          >
                            <Trash2 className='size-4 text-destructive' />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {isNew ? 'Thêm thư mục chia sẻ' : 'Sửa thư mục chia sẻ'}
              {draft?.ownerHostname ? ` — ${draft.ownerHostname}` : ''}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className='grid gap-3 py-1'>
              {isNew && (
                <Field label='Máy chia sẻ'>
                  {online.isFetching ? (
                    <p className='text-xs text-muted-foreground'>
                      Đang tải danh sách…
                    </p>
                  ) : (online.data ?? []).length === 0 ? (
                    <p className='text-xs text-muted-foreground'>
                      Không có thiết bị nào online trong 5 phút gần đây.
                    </p>
                  ) : (
                    <Select
                      value={draft.ownerMac || undefined}
                      onValueChange={(mac) => {
                        const d = (online.data ?? []).find((x) => x.mac === mac)
                        if (d) pickOwner(d)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='— chọn máy —' />
                      </SelectTrigger>
                      <SelectContent>
                        {(online.data ?? []).map((d) => (
                          <SelectItem key={d.mac} value={d.mac}>
                            {d.hostname} · {d.mac}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <Field label='Tên chia sẻ (chữ, số, dấu gạch dưới)'>
                  <Input
                    className='font-mono'
                    value={draft.shareName}
                    placeholder='du_lieu_chung'
                    onChange={(e) =>
                      setDraft({ ...draft, shareName: e.target.value })
                    }
                  />
                </Field>
                <Field label='Bật chia sẻ'>
                  <div className='flex h-9 items-center'>
                    <Switch
                      checked={draft.enabled ?? true}
                      onCheckedChange={(v) =>
                        setDraft({ ...draft, enabled: v })
                      }
                    />
                  </div>
                </Field>
              </div>
              <Field label='Đường dẫn trên máy'>
                <div className='flex gap-2'>
                  <Input
                    className='font-mono'
                    value={draft.localPath}
                    placeholder='D:\Share\DuLieuChung'
                    onChange={(e) =>
                      setDraft({ ...draft, localPath: e.target.value })
                    }
                  />
                  <Button
                    type='button'
                    variant='outline'
                    disabled={!draft.ownerMac}
                    onClick={() => {
                      if (!draft.ownerMac) return
                      setBrowseFor({
                        mac: draft.ownerMac,
                        label: draft.ownerHostname ?? draft.ownerMac,
                      })
                      void requestBrowse(
                        draft.ownerMac,
                        draft.localPath || 'D:\\'
                      )
                    }}
                  >
                    <FolderOpen className='size-4' /> Duyệt…
                  </Button>
                </div>
              </Field>

              <div className='mt-1 flex items-center gap-2 border-t pt-3'>
                <span className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
                  Phân quyền truy cập theo từng PC
                </span>
              </div>
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-10'></TableHead>
                      <TableHead>PC được truy cập</TableHead>
                      <TableHead className='w-28'>Quyền</TableHead>
                      <TableHead className='w-28'>Auto-mount</TableHead>
                      <TableHead className='w-24'>Ổ đĩa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(online.data ?? [])
                      .filter((d) => d.mac !== draft.ownerMac)
                      .map((d) => {
                        const a = accessDraft.find(
                          (x) => x.granteeMac === d.mac
                        )
                        const checked = !!a
                        return (
                          <TableRow
                            key={d.mac}
                            className={!checked ? 'opacity-60' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleGrantee(d, !!v)}
                              />
                            </TableCell>
                            <TableCell className='text-sm'>
                              {d.hostname}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={a?.access ?? 'rw'}
                                disabled={!checked}
                                onValueChange={(v) =>
                                  patchGrantee(d.mac, {
                                    access: v as 'ro' | 'rw',
                                  })
                                }
                              >
                                <SelectTrigger className='h-8'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='rw'>Đọc-ghi</SelectItem>
                                  <SelectItem value='ro'>Chỉ đọc</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={a?.autoMount ?? false}
                                disabled={!checked}
                                onCheckedChange={(v) =>
                                  patchGrantee(d.mac, { autoMount: v })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className='h-8 w-16 font-mono'
                                placeholder='Z:'
                                value={a?.mountDrive ?? ''}
                                disabled={!checked || !(a?.autoMount ?? false)}
                                onChange={(e) =>
                                  patchGrantee(d.mac, {
                                    mountDrive: e.target.value,
                                  })
                                }
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    {(online.data ?? []).filter((d) => d.mac !== draft.ownerMac)
                      .length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className='text-center text-xs text-muted-foreground'
                        >
                          Không có PC online khác để cấp quyền.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setDraft(null)}>
              Hủy
            </Button>
            <Button
              onClick={handleSave}
              disabled={save.isPending || saveAccess.isPending}
            >
              {save.isPending || saveAccess.isPending
                ? 'Đang lưu…'
                : 'Lưu & áp dụng'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder browse dialog — key theo mac để React remount hẳn component
          mỗi khi đổi máy duyệt, tránh state (đường dẫn đã chọn) của phiên
          duyệt máy A còn sót lại khi admin mở duyệt sang máy B. */}
      <BrowseDialog
        key={browseFor?.mac ?? 'none'}
        target={browseFor}
        onClose={() => setBrowseFor(null)}
        onPick={(path) => {
          setDraft((prev) => (prev ? { ...prev, localPath: path } : prev))
          setBrowseFor(null)
        }}
      />
    </div>
  )
}

function BrowseDialog({
  target,
  onClose,
  onPick,
}: {
  target: { mac: string; label: string } | null
  onClose: () => void
  onPick: (path: string) => void
}) {
  const [path, setPath] = useState<string>('')
  const qc = useQueryClient()

  const browse = useQuery({
    queryKey: ['folder-browse', target?.mac],
    queryFn: () => getBrowse(target!.mac),
    enabled: !!target,
    refetchInterval: (q) => (q.state.data?.pending ? 2000 : false),
  })

  function open(entry: BrowseEntry, base: string) {
    if (!target || !entry.is_dir) return
    const next = `${base.replace(/[\\/]+$/, '')}\\${entry.name}`
    setPath(next)
    // requestBrowse() flips server-side `pending` back to true, nhưng data
    // đang cache trong query vẫn là kết quả CŨ (pending:false) — nếu không
    // ép refetch ngay, refetchInterval ở trên sẽ không tự bật lại polling
    // (nó chỉ đọc pending từ data đã cache), và admin bấm vào thư mục con sẽ
    // không thấy gì cho tới khi đóng/mở lại dialog.
    void requestBrowse(target.mac, next).then(() =>
      qc.invalidateQueries({ queryKey: ['folder-browse', target.mac] })
    )
  }

  const resPath = browse.data?.resPath ?? ''
  const entries = browse.data?.entries ?? []

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Chọn thư mục trên {target?.label}</DialogTitle>
        </DialogHeader>
        <div className='max-h-80 overflow-y-auto rounded-md border'>
          {browse.data?.pending ? (
            <p className='p-4 text-sm text-muted-foreground'>
              Đang chờ client báo về danh sách thư mục…
            </p>
          ) : entries.length === 0 ? (
            <p className='p-4 text-sm text-muted-foreground'>
              {resPath
                ? `"${resPath}" không có thư mục con.`
                : 'Chưa có dữ liệu.'}
            </p>
          ) : (
            <div className='flex flex-col gap-0.5 p-2 font-mono text-sm'>
              {entries
                .filter((e) => e.is_dir)
                .map((e) => (
                  <button
                    key={e.name}
                    type='button'
                    className='flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent'
                    onClick={() => open(e, resPath)}
                  >
                    <Folder className='size-4 text-muted-foreground' />
                    {e.name}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className='flex items-center justify-between gap-3 pt-1'>
          <span className='truncate font-mono text-xs text-muted-foreground'>
            {path || resPath ? `Đã chọn: ${path || resPath}` : ''}
          </span>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={onClose}>
              Hủy
            </Button>
            <Button
              disabled={!(path || resPath)}
              onClick={() => onPick(path || resPath)}
            >
              Chọn
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='grid gap-1.5'>
      <Label className='text-xs text-muted-foreground'>{label}</Label>
      {children}
    </div>
  )
}
