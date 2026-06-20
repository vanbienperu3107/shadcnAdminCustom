import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { derpKeys, listDerp } from '@/features/derp/data/derp-api'
import {
  derpNameSet,
  fetchMachines,
  type HsMachine,
  hsKeys,
  isDerpNode,
  userName,
} from '@/features/headscale/hs-api'

function MachineRow({ n }: { n: HsMachine }) {
  return (
    <TableRow>
      <TableCell className='font-medium'>
        {n.givenName || n.name || '—'}
      </TableCell>
      <TableCell>{userName(n.user)}</TableCell>
      <TableCell className='font-mono text-xs'>
        {n.ipAddresses?.[0] ?? '—'}
      </TableCell>
      <TableCell>
        {n.online ? (
          <Badge
            variant='outline'
            className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          >
            <span className='me-1 inline-block size-2 rounded-full bg-emerald-500' />
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
      <TableCell className='text-xs text-muted-foreground'>
        {n.lastSeen ? new Date(n.lastSeen).toLocaleString() : '—'}
      </TableCell>
    </TableRow>
  )
}

function MachineTable({ rows }: { rows: HsMachine[] }) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tên</TableHead>
            <TableHead>User</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className='h-16 text-center text-muted-foreground'
              >
                Không có node nào.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((n, i) => <MachineRow key={n.id ?? i} n={n} />)
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function Machines() {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })
  const derp = useQuery({ queryKey: derpKeys.all, queryFn: listDerp })

  const names = derpNameSet(derp.data ?? [])
  const nodes = data?.nodes ?? []
  const userNodes = nodes.filter(
    (n) => !isDerpNode(n.givenName || n.name, names)
  )
  const derpNodes = nodes.filter((n) =>
    isDerpNode(n.givenName || n.name, names)
  )

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Machines</h2>
        <p className='text-muted-foreground'>
          Thiết bị tailnet (Headscale API) — tách thiết bị người dùng và node
          DERP. Tự làm mới 30s.
        </p>
      </div>

      {isError ? (
        <ErrorBox />
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : !data?.configured ? (
        <NotConfigured />
      ) : (
        <>
          <div className='flex flex-col gap-2'>
            <h3 className='text-sm font-semibold'>
              Thiết bị người dùng{' '}
              <span className='text-muted-foreground'>
                ({userNodes.length})
              </span>
            </h3>
            <MachineTable rows={userNodes} />
          </div>
          <div className='flex flex-col gap-2'>
            <h3 className='text-sm font-semibold'>
              Node DERP / hạ tầng{' '}
              <span className='text-muted-foreground'>
                ({derpNodes.length})
              </span>
            </h3>
            <MachineTable rows={derpNodes} />
          </div>
        </>
      )}
    </Main>
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
