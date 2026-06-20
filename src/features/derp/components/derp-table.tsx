import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  derpKeys,
  fetchHealth,
  toggleDerp,
  type ProbeResult,
} from '../data/derp-api'
import { type DerpServer } from '../data/schema'
import { useDerp } from './derp-provider'

/** Cột health THẬT (probe HTTPS). Khác cột "Trạng thái" (admin state trong DB). */
function HealthCell({
  row,
  health,
}: {
  row: DerpServer
  health: UseQueryResult<ProbeResult[]>
}) {
  if (row.embedded) {
    return <span className='text-xs text-muted-foreground'>control</span>
  }
  if (health.isFetching) {
    return (
      <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
        <Loader2 className='size-3 animate-spin' /> đang probe…
      </span>
    )
  }
  const r = health.data?.find((h) => h.regionId === row.regionId)
  if (!r) return <span className='text-muted-foreground'>—</span>
  if (r.up) {
    return (
      <Badge
        variant='outline'
        className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      >
        <span className='me-1 inline-block size-2 rounded-full bg-emerald-500' />
        {r.latencyMs}ms
      </Badge>
    )
  }
  return (
    <Badge
      variant='outline'
      className='border-destructive/40 text-destructive'
      title={r.error ?? undefined}
    >
      <span className='me-1 inline-block size-2 rounded-full bg-destructive' />
      Chết
    </Badge>
  )
}

function StatusBadge({ row }: { row: DerpServer }) {
  if (row.embedded) {
    return <Badge variant='outline'>control</Badge>
  }
  if (!row.enabled) {
    return (
      <Badge
        variant='outline'
        className='border-muted-foreground/30 text-muted-foreground'
      >
        <span className='me-1 inline-block size-2 rounded-full bg-muted-foreground' />
        Tắt
      </Badge>
    )
  }
  if (row.paused) {
    return (
      <Badge
        variant='outline'
        className='border-amber-500/40 text-amber-600 dark:text-amber-400'
      >
        <span className='me-1 inline-block size-2 rounded-full bg-amber-500' />
        Tạm dừng
      </Badge>
    )
  }
  return (
    <Badge
      variant='outline'
      className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
    >
      <span className='me-1 inline-block size-2 rounded-full bg-emerald-500' />
      Đang bật
    </Badge>
  )
}

export function DerpTable({ data }: { data: DerpServer[] }) {
  const qc = useQueryClient()
  const { setOpen, setCurrentRow } = useDerp()

  const toggleMut = useMutation({
    mutationFn: ({
      regionId,
      body,
    }: {
      regionId: number
      body: { enabled?: boolean; paused?: boolean }
    }) => toggleDerp(regionId, body),
    // Optimistic: cập nhật cache ngay -> KHÔNG reload
    onMutate: async ({ regionId, body }) => {
      await qc.cancelQueries({ queryKey: derpKeys.all })
      const prev = qc.getQueryData<DerpServer[]>(derpKeys.all)
      qc.setQueryData<DerpServer[]>(derpKeys.all, (old) =>
        old?.map((r) => (r.regionId === regionId ? { ...r, ...body } : r))
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(derpKeys.all, ctx.prev)
      toast.error('Cập nhật thất bại')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: derpKeys.all }),
  })

  // Probe health THẬT — tự chạy khi mở trang; nút "Probe lại" sẽ refetch query này.
  const health = useQuery({
    queryKey: derpKeys.health,
    queryFn: fetchHealth,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  return (
    <div className='overflow-hidden rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Region</TableHead>
            <TableHead>Host</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>Loại</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Health (live)</TableHead>
            <TableHead className='text-center'>Ưu tiên</TableHead>
            <TableHead className='text-center'>Bật/Tắt</TableHead>
            <TableHead className='text-end'>Hành động</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className='h-24 text-center'>
                Chưa có node DERP nào.
              </TableCell>
            </TableRow>
          ) : (
            data.map((row) => (
              <TableRow
                key={row.regionId}
                className={cn(row.embedded && 'bg-muted/40')}
              >
                <TableCell>
                  <span className='font-semibold'>{row.regionId}</span>
                  <span className='text-muted-foreground'> · {row.code}</span>
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.hostname}
                </TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.ipv4 ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant='secondary'>
                    {row.embedded ? 'embedded' : 'derper'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge row={row} />
                </TableCell>
                <TableCell>
                  <HealthCell row={row} health={health} />
                </TableCell>
                <TableCell className='text-center font-mono'>
                  {row.priority}
                </TableCell>
                <TableCell className='text-center'>
                  <Switch
                    checked={row.enabled && !row.paused}
                    disabled={row.embedded || toggleMut.isPending}
                    onCheckedChange={(checked) =>
                      toggleMut.mutate({
                        regionId: row.regionId,
                        body: { enabled: checked, paused: false },
                      })
                    }
                    aria-label={`Bật/tắt ${row.code}`}
                  />
                </TableCell>
                <TableCell className='text-end'>
                  {!row.embedded && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon' className='size-8'>
                          <MoreHorizontal className='size-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={() => {
                            setCurrentRow(row)
                            setOpen('edit')
                          }}
                        >
                          <Pencil className='me-2 size-4' /> Sửa
                        </DropdownMenuItem>
                        {row.paused ? (
                          <DropdownMenuItem
                            onClick={() =>
                              toggleMut.mutate({
                                regionId: row.regionId,
                                body: { paused: false },
                              })
                            }
                          >
                            <Play className='me-2 size-4' /> Tiếp tục
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() =>
                              toggleMut.mutate({
                                regionId: row.regionId,
                                body: { paused: true },
                              })
                            }
                          >
                            <Pause className='me-2 size-4' /> Tạm dừng
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => {
                            setCurrentRow(row)
                            setOpen('delete')
                          }}
                        >
                          <Trash2 className='me-2 size-4' /> Xóa
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
