import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  deleteHubDevice,
  getHubApiKey,
  getHubHealth,
  getHubStatus,
  getHubVersion,
  hubKeys,
  listHubDevices,
  registerHubDevice,
  setHubApiKey,
  type HubDevice,
} from './data/hub-api'

function shortID(id: string): string {
  return id.length > 14 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}

export function HubAdmin() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKeyState] = useState(getHubApiKey())
  const hasKey = getHubApiKey().length > 0

  const health = useQuery({
    queryKey: hubKeys.health,
    queryFn: getHubHealth,
    refetchInterval: 30_000,
  })
  const status = useQuery({
    queryKey: hubKeys.status,
    queryFn: getHubStatus,
    enabled: hasKey,
  })
  const version = useQuery({
    queryKey: hubKeys.version,
    queryFn: getHubVersion,
    enabled: hasKey,
  })
  const devices = useQuery({
    queryKey: hubKeys.devices,
    queryFn: listHubDevices,
    enabled: hasKey,
  })

  function saveKey() {
    setHubApiKey(apiKey.trim())
    void queryClient.invalidateQueries({ queryKey: ['hub'] })
    toast.success('Đã lưu API key của hub')
  }

  const revoke = useMutation({
    mutationFn: (id: string) => deleteHubDevice(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: hubKeys.devices })
      toast.success('Đã thu hồi thiết bị (token của nó bị vô hiệu)')
    },
    onError: () => toast.error('Thu hồi thất bại'),
  })

  const myID = status.data?.myID ?? ''
  const listeners = Object.entries(status.data?.connectionServiceStatus ?? {})

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <p className='text-sm text-muted-foreground'>
        Quản trị hub syncthingMem0 — trạng thái, thiết bị đã đăng ký và cấp/thu
        hồi token. Kết nối tới REST của hub qua proxy <code>/hub</code>.
      </p>

      {/* Cấu hình kết nối */}
      <Card>
        <CardHeader>
          <CardTitle>Kết nối hub</CardTitle>
          <CardDescription>
            Dán API key của hub (trong <code>config.xml</code> mục{' '}
            <code>&lt;apikey&gt;</code>). Lưu cục bộ trên trình duyệt.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3 sm:flex-row sm:items-end'>
          <div className='flex-1 space-y-1.5'>
            <Label htmlFor='hub-api-key'>API key</Label>
            <Input
              id='hub-api-key'
              type='password'
              value={apiKey}
              onChange={(e) => setApiKeyState(e.target.value)}
              placeholder='X-API-Key của hub'
            />
          </div>
          <Button onClick={saveKey}>Lưu</Button>
        </CardContent>
      </Card>

      {/* Trạng thái hub */}
      <Card>
        <CardHeader className='flex-row items-center justify-between'>
          <div>
            <CardTitle>Trạng thái</CardTitle>
            <CardDescription>
              Health, phiên bản và listener WSS của hub.
            </CardDescription>
          </div>
          <Badge variant={health.data?.status === 'OK' ? 'default' : 'destructive'}>
            {health.data?.status === 'OK' ? 'OK' : 'Không phản hồi'}
          </Badge>
        </CardHeader>
        <CardContent className='grid gap-2 text-sm'>
          {!hasKey ? (
            <p className='text-muted-foreground'>
              Nhập API key ở trên để xem chi tiết.
            </p>
          ) : status.isError ? (
            <p className='text-destructive'>
              Không tải được trạng thái. Kiểm tra API key và proxy <code>/hub</code>.
            </p>
          ) : (
            <>
              <Row label='Hub device ID' value={myID ? shortID(myID) : '…'} />
              <Row
                label='Phiên bản'
                value={version.data ? version.data.version : '…'}
              />
              <Row
                label='Discovery'
                value={status.data?.discoveryEnabled ? 'bật' : 'tắt (hub model)'}
              />
              <div className='pt-1'>
                <div className='mb-1 text-muted-foreground'>Listener WSS</div>
                {listeners.length === 0 ? (
                  <span className='text-muted-foreground'>—</span>
                ) : (
                  <ul className='space-y-1'>
                    {listeners.map(([addr, s]) => (
                      <li key={addr} className='flex items-center gap-2'>
                        <Badge
                          variant={s.error ? 'destructive' : 'secondary'}
                        >
                          {s.error ? 'lỗi' : 'up'}
                        </Badge>
                        <code>{addr}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Thiết bị */}
      <Card>
        <CardHeader className='flex-row items-center justify-between'>
          <div>
            <CardTitle>Thiết bị đã đăng ký</CardTitle>
            <CardDescription>
              Thu hồi = xóa thiết bị, token bearer của nó bị vô hiệu ngay.
            </CardDescription>
          </div>
          <RegisterDialog
            onDone={() =>
              queryClient.invalidateQueries({ queryKey: hubKeys.devices })
            }
            disabled={!hasKey}
          />
        </CardHeader>
        <CardContent>
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-56'>Device ID</TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead className='w-28 text-right'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!hasKey ? (
                  <EmptyRow text='Nhập API key để xem thiết bị' />
                ) : devices.isLoading ? (
                  <EmptyRow text='Đang tải…' />
                ) : (devices.data?.length ?? 0) === 0 ? (
                  <EmptyRow text='Chưa có thiết bị' />
                ) : (
                  devices.data!.map((d: HubDevice) => {
                    const isHub = d.deviceID === myID
                    return (
                      <TableRow key={d.deviceID}>
                        <TableCell className='font-mono text-xs'>
                          {shortID(d.deviceID)}
                        </TableCell>
                        <TableCell>
                          {d.name || '—'}{' '}
                          {isHub && <Badge variant='secondary'>hub</Badge>}
                        </TableCell>
                        <TableCell className='text-right'>
                          <Button
                            size='sm'
                            variant='destructive'
                            disabled={isHub || revoke.isPending}
                            onClick={() => revoke.mutate(d.deviceID)}
                          >
                            Thu hồi
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-mono'>{value}</span>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={3}
        className='text-center text-sm text-muted-foreground'
      >
        {text}
      </TableCell>
    </TableRow>
  )
}

function RegisterDialog({
  onDone,
  disabled,
}: {
  onDone: () => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')

  const mutation = useMutation({
    mutationFn: () => registerHubDevice(name.trim(), secret.trim()),
    onSuccess: (res) => {
      setToken(res.token)
      toast.success(`Đã đăng ký thiết bị ${res.device_id.slice(0, 7)}…`)
      onDone()
    },
    onError: () =>
      toast.error('Đăng ký thất bại (kiểm tra registration secret của hub)'),
  })

  function reset() {
    setName('')
    setSecret('')
    setToken('')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>Đăng ký thiết bị</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đăng ký thiết bị mới</DialogTitle>
          <DialogDescription>
            Hub cấp device ID + token. Registration secret phải khớp cấu hình
            hub, nếu không hub trả 403.
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className='space-y-2'>
            <Label>Token (lưu ngay, chỉ hiện một lần)</Label>
            <textarea
              readOnly
              className='h-28 w-full rounded-md border bg-muted p-2 font-mono text-xs'
              value={token}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : (
          <div className='space-y-3'>
            <div className='space-y-1.5'>
              <Label htmlFor='dev-name'>Tên thiết bị</Label>
              <Input
                id='dev-name'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='laptop-an'
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='reg-secret'>Registration secret</Label>
              <Input
                id='reg-secret'
                type='password'
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button onClick={() => setOpen(false)}>Đóng</Button>
          ) : (
            <Button
              onClick={() => mutation.mutate()}
              disabled={!name.trim() || mutation.isPending}
            >
              {mutation.isPending ? 'Đang đăng ký…' : 'Đăng ký'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
