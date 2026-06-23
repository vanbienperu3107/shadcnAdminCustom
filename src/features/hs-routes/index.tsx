import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  deleteRoute,
  enableRoute,
  fetchRoutes,
  type HsRoute,
  hsKeys,
} from '@/features/headscale/hs-api'
import { ErrorBox, NotConfigured } from '@/features/machines'

function RouteRow({
  route,
  onEnable,
  onDelete,
  loading,
}: {
  route: HsRoute
  onEnable: () => void
  onDelete: () => void
  loading?: boolean
}) {
  const nodeName =
    route.node?.givenName || route.node?.name || route.node?.id || '—'
  return (
    <TableRow>
      <TableCell className='font-mono text-sm'>{route.prefix ?? '—'}</TableCell>
      <TableCell className='text-sm'>{nodeName}</TableCell>
      <TableCell>
        {route.enabled ? (
          <Badge
            variant='outline'
            className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          >
            <CheckCircle2 className='me-1 h-3 w-3' />
            Enabled
          </Badge>
        ) : (
          <Badge
            variant='outline'
            className='border-muted-foreground/30 text-muted-foreground'
          >
            <XCircle className='me-1 h-3 w-3' />
            Disabled
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {route.isPrimary ? (
          <Badge variant='secondary'>Primary</Badge>
        ) : (
          <span className='text-xs text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell className='text-xs text-muted-foreground'>
        {route.updatedAt ? new Date(route.updatedAt).toLocaleString() : '—'}
      </TableCell>
      <TableCell className='text-right'>
        <div className='flex items-center justify-end gap-2'>
          {!route.enabled && (
            <Button
              size='sm'
              variant='outline'
              onClick={onEnable}
              disabled={loading}
            >
              Enable
            </Button>
          )}
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8 text-destructive hover:text-destructive'
            onClick={onDelete}
            disabled={loading}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function HsRoutes() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.routes,
    queryFn: fetchRoutes,
    refetchInterval: 30_000,
  })

  const enableMut = useMutation({
    mutationFn: (id: string) => enableRoute(id),
    onSuccess: () => {
      toast.success('Đã enable route')
      void qc.invalidateQueries({ queryKey: hsKeys.routes })
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRoute(id),
    onSuccess: () => {
      toast.success('Đã xoá route')
      void qc.invalidateQueries({ queryKey: hsKeys.routes })
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  const routes = data?.routes ?? []
  const loading = enableMut.isPending || deleteMut.isPending

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Routes</h2>
        <p className='text-muted-foreground'>
          Subnet routes các node quảng bá trong tailnet (DERP-Controller API).
          Tự làm mới 30s.
        </p>
      </div>

      {isError ? (
        <ErrorBox />
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : !data?.configured ? (
        <NotConfigured />
      ) : routes.length === 0 ? (
        <div className='rounded-md border p-6 text-center text-sm text-muted-foreground'>
          Không có route nào được quảng bá.
        </div>
      ) : (
        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prefix</TableHead>
                <TableHead>Node</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Cập nhật</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map((r, i) => (
                <RouteRow
                  key={r.id ?? i}
                  route={r}
                  loading={loading}
                  onEnable={() => r.id && enableMut.mutate(r.id)}
                  onDelete={() => r.id && deleteMut.mutate(r.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Main>
  )
}
