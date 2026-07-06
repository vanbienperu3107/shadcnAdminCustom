import { memo, useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  deleteMachine,
  derpNameSet,
  deviceTypeMap,
  expireMachine,
  fetchDevices,
  fetchMachines,
  type HsMachine,
  hsKeys,
  isDerpNodeV2,
  renameMachine,
  userName,
} from '@/features/headscale/hs-api'

/** Headscale node name = DNS label: chữ thường a-z0-9 và '-', không bắt đầu/kết
 *  thúc bằng '-'. Bỏ dấu tiếng Việt, hạ chữ thường, thay ký tự lạ bằng '-'. */
function slugifyNodeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu (combining diacritical marks)
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63) // giới hạn DNS label
}

function RenameDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: HsMachine | null
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const slug = slugifyNodeName(name)

  const mut = useMutation({
    mutationFn: () => renameMachine(row!.id!, slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hsKeys.machines })
      toast.success('Đã đổi tên thiết bị')
      onOpenChange(false)
    },
    onError: (e) =>
      toast.error(
        `Đổi tên thất bại: ${e instanceof Error ? e.message : String(e)}`
      ),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (o) setName(row?.givenName || row?.name || '')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đổi tên thiết bị</DialogTitle>
          <DialogDescription>
            Đổi given name hiển thị trên tailnet cho{' '}
            <b>{row?.givenName || row?.name}</b>. Headscale chỉ chấp nhận chữ
            thường, số và dấu gạch ngang — ký tự khác sẽ tự chuyển đổi.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='ten-thiet-bi'
          autoFocus
        />
        {name.trim() && (
          <p className='text-xs text-muted-foreground'>
            Sẽ đặt tên: <span className='font-mono'>{slug || '—'}</span>
          </p>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!slug || mut.isPending || !row?.id}
          >
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: HsMachine | null
}) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => deleteMachine(row!.id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hsKeys.machines })
      toast.success('Đã xóa thiết bị')
      onOpenChange(false)
    },
    onError: () => toast.error('Xóa thất bại'),
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className='text-destructive'>
            Xóa thiết bị?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <b>{row?.givenName || row?.name}</b> sẽ bị xóa hẳn khỏi headscale.
            Thiết bị này sẽ mất kết nối tailnet ngay lập tức và phải đăng ký lại
            (auth URL mới) để dùng lại. Hành động không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Hủy</AlertDialogCancel>
          <AlertDialogAction
            className='bg-destructive text-white hover:bg-destructive/90'
            onClick={(e) => {
              e.preventDefault()
              mut.mutate()
            }}
            disabled={mut.isPending || !row?.id}
          >
            Xóa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ExpireDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: HsMachine | null
}) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => expireMachine(row!.id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hsKeys.machines })
      toast.success('Đã thu hồi key — thiết bị cần đăng nhập lại')
      onOpenChange(false)
    },
    onError: () => toast.error('Thu hồi thất bại'),
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Thu hồi key thiết bị?</AlertDialogTitle>
          <AlertDialogDescription>
            <b>{row?.givenName || row?.name}</b> vẫn còn trong headscale nhưng
            node key hết hạn ngay — thiết bị phải mở lại link đăng nhập để dùng
            lại tailnet. Dùng khi nghi ngờ máy bị lộ key, không muốn xóa hẳn
            thiết bị.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Hủy</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              mut.mutate()
            }}
            disabled={mut.isPending || !row?.id}
          >
            Thu hồi
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type DialogKind = 'rename' | 'delete' | 'expire' | null

// memo: bảng poll 30s -> parent re-render; chỉ vẽ lại hàng có dữ liệu đổi.
const MachineRow = memo(function MachineRow({
  n,
  onAction,
}: {
  n: HsMachine
  onAction: (kind: DialogKind, row: HsMachine) => void
}) {
  return (
    <TableRow>
      <TableCell className='font-medium'>
        {n.givenName || n.name || '—'}
      </TableCell>
      <TableCell className='hidden text-xs text-muted-foreground md:table-cell'>
        {userName(n.user)}
      </TableCell>
      <TableCell className='hidden font-mono text-xs lg:table-cell'>
        {n.ipAddresses?.[0] ?? '—'}
      </TableCell>
      <TableCell>
        {n.online ? (
          <Badge
            variant='outline'
            className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          >
            <span className='me-1 inline-block size-2 animate-pulse rounded-full bg-emerald-500' />
            Connected
          </Badge>
        ) : (
          <Badge
            variant='outline'
            className='border-muted-foreground/30 text-muted-foreground'
          >
            <span className='me-1 inline-block size-2 rounded-full bg-muted-foreground' />
            offline
          </Badge>
        )}
      </TableCell>
      <TableCell className='hidden text-xs text-muted-foreground lg:table-cell'>
        {n.lastSeen ? new Date(n.lastSeen).toLocaleString() : '—'}
      </TableCell>
      <TableCell className='text-end'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='size-8'
              disabled={!n.id}
            >
              <MoreHorizontal className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onAction('rename', n)}>
              <Pencil className='me-2 size-4' /> Đổi tên
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction('expire', n)}>
              <RotateCcw className='me-2 size-4' /> Thu hồi key
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onClick={() => onAction('delete', n)}
            >
              <Trash2 className='me-2 size-4' /> Xóa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
})

function MachineTable({
  rows,
  onAction,
}: {
  rows: HsMachine[]
  onAction: (kind: DialogKind, row: HsMachine) => void
}) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tên</TableHead>
            <TableHead className='hidden md:table-cell'>User</TableHead>
            <TableHead className='hidden lg:table-cell'>IP</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead className='hidden lg:table-cell'>Last seen</TableHead>
            <TableHead className='text-end'>Hành động</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className='h-16 text-center text-muted-foreground'
              >
                Không có node nào.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((n, i) => (
              <MachineRow key={n.id ?? i} n={n} onAction={onAction} />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Bảng thiết bị (self-contained): tự query + lọc + dialog. variant:
 *  - 'users': máy thật của người dùng
 *  - 'derp' : node hạ tầng DERP
 */
export function DevicesTable({ variant }: { variant: 'users' | 'derp' }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })
  const derp = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })
  const devices = useQuery({ queryKey: ['devices'], queryFn: fetchDevices })

  const [dialog, setDialog] = useState<DialogKind>(null)
  const [currentRow, setCurrentRow] = useState<HsMachine | null>(null)
  // useCallback: giữ identity ổn định để React.memo trên MachineRow có tác dụng.
  const onAction = useCallback((kind: DialogKind, row: HsMachine) => {
    setCurrentRow(row)
    setDialog(kind)
  }, [])

  const names = derpNameSet(derp.data ?? [])
  const typeByNodeKey = deviceTypeMap(devices.data ?? [])
  const nodes = data?.nodes ?? []
  const rows = nodes
    .filter((n) =>
      variant === 'derp'
        ? isDerpNodeV2(n, typeByNodeKey, names)
        : !isDerpNodeV2(n, typeByNodeKey, names)
    )
    .sort((a, b) => Number(b.online) - Number(a.online))

  return (
    <>
      {isError ? (
        <ErrorBox />
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : !data?.configured ? (
        <NotConfigured />
      ) : (
        <MachineTable rows={rows} onAction={onAction} />
      )}

      <RenameDialog
        open={dialog === 'rename'}
        onOpenChange={(o) => !o && setDialog(null)}
        row={currentRow}
      />
      <DeleteDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        row={currentRow}
      />
      <ExpireDialog
        open={dialog === 'expire'}
        onOpenChange={(o) => !o && setDialog(null)}
        row={currentRow}
      />
    </>
  )
}

export function NotConfigured() {
  return (
    <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm'>
      Chưa cấu hình <span className='font-mono'>HEADSCALE_API_KEY</span> trên
      server.
    </div>
  )
}

export function ErrorBox() {
  return (
    <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
      Không gọi được Headscale API (kiểm tra key / kết nối tới headscale:8080).
    </div>
  )
}
