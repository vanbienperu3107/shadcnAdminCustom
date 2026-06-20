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
import { DashHeader } from '@/components/layout/page-header'
import { fetchMachines, hsKeys, userName } from '@/features/headscale/hs-api'

export function Machines() {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.machines,
    queryFn: fetchMachines,
    refetchInterval: 30_000,
  })

  return (
    <>
      <DashHeader />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Machines</h2>
          <p className='text-muted-foreground'>
            Thiết bị trong tailnet (từ Headscale API). Tự làm mới 30s.
          </p>
        </div>

        {isError ? (
          <ErrorBox />
        ) : isLoading ? (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        ) : !data?.configured ? (
          <NotConfigured />
        ) : (
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
                {data.nodes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className='h-24 text-center'>
                      Không có machine nào.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.nodes.map((n, i) => (
                    <TableRow key={n.id ?? i}>
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
                        {n.lastSeen
                          ? new Date(n.lastSeen).toLocaleString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}

export function NotConfigured() {
  return (
    <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm'>
      Chưa cấu hình <span className='font-mono'>HEADSCALE_API_KEY</span> — thêm
      secret này vào repo (giá trị = headscale apikey, chính là{' '}
      <span className='font-mono'>HEADPLANE_HS_API_KEY</span>) rồi deploy lại để
      xem dữ liệu.
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
