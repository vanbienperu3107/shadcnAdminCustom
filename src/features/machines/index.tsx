import { memo, useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DownloadCloud,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'
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
import {
  checkNowClientUpdateForMac,
  clientUpdateKeys,
  getClientUpdate,
} from '@/features/client-update/data/client-update-api'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  type Device,
  deleteMachine,
  derpNameSet,
  deviceByNodeKey,
  type DeviceVersionInfo,
  deviceTypeMap,
  deviceVersionMap,
  expireMachine,
  fetchDevices,
  fetchMachines,
  type HsMachine,
  hsKeys,
  isDerpNodeV2,
  renameMachine,
  updateDevice,
  userName,
} from '@/features/headscale/hs-api'
import {
  listNodeRuntime,
  nodeRuntimeKeys,
  upsertNodeRuntime,
} from '@/features/node-runtime/data/node-runtime-api'

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

type DialogKind = 'rename' | 'delete' | 'expire' | 'static-ip' | null

/** IPv4 hợp lệ dạng a.b.c.d, mỗi octet 0–255. Rỗng = hợp lệ (nghĩa là gỡ pin). */
function isValidIpv4OrEmpty(s: string): boolean {
  const v = s.trim()
  if (v === '') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v)
  if (!m) return false
  return m.slice(1).every((o) => Number(o) <= 255)
}

// Gán IP tĩnh (device_identity.static_ipv4) cho 1 máy. Headscale đọc giá trị
// này lúc đăng ký node (GET /api/internal/reserved-ip, ưu tiên hơn lastIpv4)
// để LUÔN cấp đúng IP đó cho MAC này — pin CỨNG, không trôi. Bỏ trống = gỡ
// pin, quay lại pin mềm theo lastIpv4.
function StaticIpDialog({
  open,
  onOpenChange,
  row,
  device,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: HsMachine | null
  device: Device | undefined
}) {
  const qc = useQueryClient()
  const [ip, setIp] = useState('')
  const valid = isValidIpv4OrEmpty(ip)

  const mut = useMutation({
    mutationFn: () =>
      updateDevice(device!.id, { staticIpv4: ip.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      toast.success(
        ip.trim()
          ? 'Đã gán IP tĩnh — áp dụng khi máy đăng ký lại (khởi động client)'
          : 'Đã gỡ IP tĩnh'
      )
      onOpenChange(false)
    },
    onError: (e) =>
      toast.error(
        `Lưu IP tĩnh thất bại: ${e instanceof Error ? e.message : String(e)}`
      ),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (o) setIp(device?.staticIpv4 ?? '')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gán IP tĩnh</DialogTitle>
          <DialogDescription>
            Ép <b>{row?.givenName || row?.name}</b> luôn nhận đúng 1 IP tailnet
            (pin cứng theo MAC). Bỏ trống để gỡ pin (quay lại IP tự động). IP
            hiện tại:{' '}
            <span className='font-mono'>
              {device?.lastIpv4 ?? row?.ipAddresses?.[0] ?? '—'}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        {!device ? (
          <p className='text-sm text-muted-foreground'>
            Máy này chưa có bản ghi thiết bị (device_identity) — cần client báo
            danh tính (MAC) về trước khi gán được IP tĩnh.
          </p>
        ) : (
          <>
            <Input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder='100.64.0.12'
              className='font-mono'
              autoFocus
            />
            {!valid && (
              <p className='text-xs text-destructive'>
                IPv4 không hợp lệ (dạng a.b.c.d, mỗi số 0–255).
              </p>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!device || !valid || mut.isPending}
          >
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// memo: bảng poll 30s -> parent re-render; chỉ vẽ lại hàng có dữ liệu đổi.
const MachineRow = memo(function MachineRow({
  n,
  version,
  latestBuild,
  autoUpdateByMac,
  staticIp,
  onUpdateNow,
  onSetAutoUpdate,
  onAction,
}: {
  n: HsMachine
  version?: DeviceVersionInfo
  latestBuild: number | null
  autoUpdateByMac: Map<string, boolean | null>
  staticIp: string | null
  onUpdateNow: (mac: string) => void
  onSetAutoUpdate: (mac: string, enabled: boolean | null) => void
  onAction: (kind: DialogKind, row: HsMachine) => void
}) {
  // null/chưa có dòng override = theo cấu hình toàn cục ("Bật" mặc định).
  const autoUpdateOverride = version?.mac
    ? (autoUpdateByMac.get(version.mac) ?? null)
    : null
  return (
    <TableRow>
      <TableCell className='font-medium'>
        {n.givenName || n.name || '—'}
      </TableCell>
      <TableCell className='hidden text-xs text-muted-foreground md:table-cell'>
        {userName(n.user)}
      </TableCell>
      <TableCell className='hidden font-mono text-xs lg:table-cell'>
        <div className='flex flex-col gap-0.5'>
          <span>{n.ipAddresses?.[0] ?? '—'}</span>
          {staticIp && (
            <Badge
              variant='outline'
              className='w-fit border-sky-500/40 text-sky-600 dark:text-sky-400'
              title='IP tĩnh đã gán (pin cứng theo MAC)'
            >
              <Pin className='me-1 size-3' /> {staticIp}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className='hidden font-mono text-xs xl:table-cell'>
        {version?.version ? (
          <div className='flex flex-col gap-1'>
            <span
              title={
                version.build != null ? `build ${version.build}` : undefined
              }
            >
              {version.version}
              {version.variant && (
                <span className='text-muted-foreground'>
                  {' '}
                  · {version.variant}
                </span>
              )}
            </span>
            {version.build != null && latestBuild != null && (
              <Badge
                variant='outline'
                className={
                  version.build >= latestBuild
                    ? 'w-fit border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'w-fit border-amber-500/40 text-amber-600 dark:text-amber-400'
                }
              >
                {version.build >= latestBuild
                  ? 'Mới nhất'
                  : `Có bản mới (${latestBuild})`}
              </Badge>
            )}
            {autoUpdateOverride === false && (
              <Badge
                variant='outline'
                className='w-fit border-muted-foreground/30 text-muted-foreground'
              >
                Auto-update: tắt riêng
              </Badge>
            )}
          </div>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
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
            <DropdownMenuItem onClick={() => onAction('static-ip', n)}>
              <Pin className='me-2 size-4' /> Gán IP tĩnh
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction('expire', n)}>
              <RotateCcw className='me-2 size-4' /> Thu hồi key
            </DropdownMenuItem>
            {version?.mac && (
              <DropdownMenuItem onClick={() => onUpdateNow(version.mac!)}>
                <RefreshCw className='me-2 size-4' /> Cập nhật ngay
              </DropdownMenuItem>
            )}
            {version?.mac && (
              <DropdownMenuItem
                onClick={() =>
                  onSetAutoUpdate(
                    version.mac!,
                    autoUpdateOverride === false ? null : false
                  )
                }
              >
                <DownloadCloud className='me-2 size-4' />
                {autoUpdateOverride === false
                  ? 'Bật lại auto-update cho máy này'
                  : 'Tắt auto-update cho máy này'}
              </DropdownMenuItem>
            )}
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
  versionByNodeKey,
  latestBuild,
  autoUpdateByMac,
  staticIpByNodeKey,
  onUpdateNow,
  onSetAutoUpdate,
  onAction,
}: {
  rows: HsMachine[]
  versionByNodeKey: Map<string, DeviceVersionInfo>
  latestBuild: number | null
  autoUpdateByMac: Map<string, boolean | null>
  staticIpByNodeKey: Map<string, string | null>
  onUpdateNow: (mac: string) => void
  onSetAutoUpdate: (mac: string, enabled: boolean | null) => void
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
            <TableHead className='hidden xl:table-cell'>Phiên bản</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead className='hidden lg:table-cell'>Last seen</TableHead>
            <TableHead className='text-end'>Hành động</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className='h-16 text-center text-muted-foreground'
              >
                Không có node nào.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((n, i) => (
              <MachineRow
                key={n.id ?? i}
                n={n}
                version={
                  n.nodeKey ? versionByNodeKey.get(n.nodeKey) : undefined
                }
                latestBuild={latestBuild}
                autoUpdateByMac={autoUpdateByMac}
                staticIp={
                  n.nodeKey ? (staticIpByNodeKey.get(n.nodeKey) ?? null) : null
                }
                onUpdateNow={onUpdateNow}
                onSetAutoUpdate={onSetAutoUpdate}
                onAction={onAction}
              />
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
  const clientUpdateCfg = useQuery({
    queryKey: clientUpdateKeys.all,
    queryFn: getClientUpdate,
  })
  const nodeRuntimes = useQuery({
    queryKey: nodeRuntimeKeys.all,
    queryFn: listNodeRuntime,
  })
  const qc = useQueryClient()

  const [dialog, setDialog] = useState<DialogKind>(null)
  const [currentRow, setCurrentRow] = useState<HsMachine | null>(null)
  // useCallback: giữ identity ổn định để React.memo trên MachineRow có tác dụng.
  const onAction = useCallback((kind: DialogKind, row: HsMachine) => {
    setCurrentRow(row)
    setDialog(kind)
  }, [])

  // "Cập nhật" cho 1 máy — không cần đợi bấm xong mới thấy tác dụng (client tự
  // poll 20s), chỉ cần toast xác nhận đã gửi yêu cầu.
  const checkNowForMac = useMutation({
    mutationFn: (mac: string) => checkNowClientUpdateForMac(mac),
    onSuccess: () =>
      toast.success('Đã gửi yêu cầu — máy sẽ kiểm tra trong ít giây'),
    onError: () => toast.error('Gửi yêu cầu cập nhật thất bại'),
  })

  // Ép bật/tắt auto-update riêng 1 máy (ghi đè cấu hình toàn cục) — dùng chung
  // endpoint PUT /api/node-runtime/:mac, chỉ patch đúng field này.
  const setAutoUpdateForMac = useMutation({
    mutationFn: ({ mac, enabled }: { mac: string; enabled: boolean | null }) =>
      upsertNodeRuntime(mac, { autoUpdateEnabled: enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: nodeRuntimeKeys.all })
      toast.success('Đã lưu')
    },
    onError: () => toast.error('Lưu thất bại'),
  })

  const names = derpNameSet(derp.data ?? [])
  const typeByNodeKey = deviceTypeMap(devices.data ?? [])
  const versionByNodeKey = deviceVersionMap(devices.data ?? [])
  const deviceMap = deviceByNodeKey(devices.data ?? [])
  const staticIpByNodeKey = new Map(
    (devices.data ?? []).map((d) => [d.nodeKey ?? '', d.staticIpv4])
  )
  const autoUpdateByMac = new Map(
    (nodeRuntimes.data ?? []).map((r) => [r.mac, r.autoUpdateEnabled])
  )
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
        <MachineTable
          rows={rows}
          versionByNodeKey={versionByNodeKey}
          latestBuild={clientUpdateCfg.data?.latestBuild ?? null}
          autoUpdateByMac={autoUpdateByMac}
          staticIpByNodeKey={staticIpByNodeKey}
          onUpdateNow={(mac) => checkNowForMac.mutate(mac)}
          onSetAutoUpdate={(mac, enabled) =>
            setAutoUpdateForMac.mutate({ mac, enabled })
          }
          onAction={onAction}
        />
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
      <StaticIpDialog
        open={dialog === 'static-ip'}
        onOpenChange={(o) => !o && setDialog(null)}
        row={currentRow}
        device={
          currentRow?.nodeKey ? deviceMap.get(currentRow.nodeKey) : undefined
        }
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
