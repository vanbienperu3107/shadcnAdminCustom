import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, TimerOff } from 'lucide-react'
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
  createPreAuthKey,
  expirePreAuthKey,
  fetchHsUsers,
  fetchPreAuthKeys,
  type HsPreAuthKey,
  hsKeys,
} from '@/features/headscale/hs-api'
import { ErrorBox, NotConfigured } from '@/features/machines'

function CreateKeyDialog({
  open,
  users,
  onClose,
}: {
  open: boolean
  users: string[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [user, setUser] = useState(users[0] ?? '')
  const [reusable, setReusable] = useState(false)
  const [ephemeral, setEphemeral] = useState(false)
  const [expireDays, setExpireDays] = useState('90')
  const [newKey, setNewKey] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: () => {
      const expiration = new Date(
        Date.now() + Number(expireDays) * 86_400_000
      ).toISOString()
      return createPreAuthKey({ user, reusable, ephemeral, expiration })
    },
    onSuccess: (key) => {
      const keyStr =
        typeof key === 'string' ? key : ((key as HsPreAuthKey).key ?? '')
      setNewKey(keyStr)
      void qc.invalidateQueries({ queryKey: hsKeys.preauthkeys(user) })
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const handleClose = () => {
    setNewKey(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo pre-auth key</DialogTitle>
        </DialogHeader>

        {newKey ? (
          <div className='space-y-3'>
            <p className='text-sm text-muted-foreground'>
              Copy key này ngay — chỉ hiển thị một lần.
            </p>
            <div className='flex items-center gap-2 rounded-md border bg-muted/40 p-3'>
              <code className='flex-1 text-xs break-all'>{newKey}</code>
              <Button
                size='icon'
                variant='ghost'
                className='h-8 w-8 shrink-0'
                onClick={() => {
                  void navigator.clipboard.writeText(newKey)
                  toast.success('Đã copy key')
                }}
              >
                <Copy className='h-4 w-4' />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Đóng</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label>User</Label>
                <Select value={user} onValueChange={setUser}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label>Hết hạn sau (ngày)</Label>
                <Input
                  type='number'
                  min={1}
                  max={365}
                  value={expireDays}
                  onChange={(e) => setExpireDays(e.target.value)}
                />
              </div>

              <div className='flex items-center gap-6'>
                <label className='flex cursor-pointer items-center gap-2 text-sm'>
                  <Checkbox
                    checked={reusable}
                    onCheckedChange={(v) => setReusable(!!v)}
                  />
                  Reusable
                </label>
                <label className='flex cursor-pointer items-center gap-2 text-sm'>
                  <Checkbox
                    checked={ephemeral}
                    onCheckedChange={(v) => setEphemeral(!!v)}
                  />
                  Ephemeral
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant='outline'
                onClick={handleClose}
                disabled={mut.isPending}
              >
                Huỷ
              </Button>
              <Button
                onClick={() => mut.mutate()}
                disabled={mut.isPending || !user}
              >
                {mut.isPending ? 'Đang tạo…' : 'Tạo key'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function KeyRow({
  k,
  onExpire,
  loading,
}: {
  k: HsPreAuthKey
  onExpire: () => void
  loading?: boolean
}) {
  const expired = k.expiration ? new Date(k.expiration) < new Date() : false
  return (
    <TableRow>
      <TableCell className='font-mono text-xs'>
        {k.key ? `${k.key.slice(0, 12)}…` : '—'}
      </TableCell>
      <TableCell>{k.user ?? '—'}</TableCell>
      <TableCell>
        <div className='flex flex-wrap gap-1'>
          {k.reusable && <Badge variant='secondary'>Reusable</Badge>}
          {k.ephemeral && <Badge variant='secondary'>Ephemeral</Badge>}
          {k.used && <Badge variant='outline'>Used</Badge>}
          {expired && (
            <Badge
              variant='outline'
              className='border-destructive/40 text-destructive'
            >
              Expired
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className='text-xs text-muted-foreground'>
        {k.expiration ? new Date(k.expiration).toLocaleString() : '—'}
      </TableCell>
      <TableCell className='text-right'>
        {!expired && (
          <Button
            size='sm'
            variant='ghost'
            className='h-8 gap-1 text-xs'
            onClick={onExpire}
            disabled={loading}
          >
            <TimerOff className='h-3.5 w-3.5' />
            Expire
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

export function PreAuthKeys() {
  const usersQ = useQuery({ queryKey: hsKeys.users, queryFn: fetchHsUsers })
  const users = (usersQ.data?.users ?? [])
    .map((u) => u.name ?? '')
    .filter(Boolean)

  const [selectedUser, setSelectedUser] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const qc = useQueryClient()
  const keysQ = useQuery({
    queryKey: hsKeys.preauthkeys(selectedUser),
    queryFn: () => fetchPreAuthKeys(selectedUser),
    enabled: !!selectedUser,
  })

  const expireMut = useMutation({
    mutationFn: ({ user, key }: { user: string; key: string }) =>
      expirePreAuthKey(user, key),
    onSuccess: () => {
      toast.success('Đã expire key')
      void qc.invalidateQueries({ queryKey: hsKeys.preauthkeys(selectedUser) })
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Pre-auth Keys</h2>
          <p className='text-muted-foreground'>
            Key để đăng ký thiết bị vào tailnet mà không cần xác thực thủ công.
          </p>
        </div>
        <Button
          size='sm'
          onClick={() => setCreateOpen(true)}
          disabled={users.length === 0}
        >
          <Plus className='mr-2 h-4 w-4' />
          Tạo key
        </Button>
      </div>

      {!usersQ.data?.configured ? (
        <NotConfigured />
      ) : (
        <>
          <div className='flex items-center gap-3'>
            <Label className='shrink-0 text-sm'>Xem key của user:</Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger className='w-48'>
                <SelectValue placeholder='Chọn user…' />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser &&
            (keysQ.isError ? (
              <ErrorBox />
            ) : keysQ.isLoading ? (
              <p className='text-sm text-muted-foreground'>Đang tải…</p>
            ) : (
              <div className='overflow-hidden rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key (12 ký tự đầu)</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead>Hết hạn</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keysQ.data?.preAuthKeys ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className='h-16 text-center text-muted-foreground'
                        >
                          Không có key nào.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (keysQ.data?.preAuthKeys ?? []).map((k, i) => (
                        <KeyRow
                          key={k.id ?? i}
                          k={k}
                          loading={expireMut.isPending}
                          onExpire={() =>
                            k.user &&
                            k.key &&
                            expireMut.mutate({ user: k.user, key: k.key })
                          }
                        />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            ))}
        </>
      )}

      <CreateKeyDialog
        open={createOpen}
        users={users}
        onClose={() => setCreateOpen(false)}
      />
    </Main>
  )
}
