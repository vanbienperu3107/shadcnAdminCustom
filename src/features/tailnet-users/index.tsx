import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchHsUsers, hsKeys } from '@/features/headscale/hs-api'
import { ErrorBox, NotConfigured } from '@/features/machines'

/** Nội dung tab "Users" trong màn hình Tailnet Access — query chỉ chạy khi
 *  tab này được mở (Radix Tabs không mount TabsContent chưa active). */
export function TailnetUsers() {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.users,
    queryFn: fetchHsUsers,
    refetchInterval: 30_000,
  })

  return (
    <div className='flex flex-1 flex-col gap-4 sm:gap-6'>
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
                <TableHead>ID</TableHead>
                <TableHead>Tạo lúc</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className='h-24 text-center'>
                    Không có user nào.
                  </TableCell>
                </TableRow>
              ) : (
                data.users.map((u, i) => (
                  <TableRow key={u.id ?? i}>
                    <TableCell className='font-medium'>
                      {u.name || u.displayName || u.email || '—'}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {u.id ?? '—'}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {u.createdAt
                        ? new Date(u.createdAt).toLocaleString()
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
