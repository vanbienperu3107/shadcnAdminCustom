import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Main } from '@/components/layout/main'
import {
  configKeys,
  listClientConfig,
  listClientPorts,
  updateClientConfig,
  type ClientConfigRow,
} from './data/client-config-api'

type EditState = { key: string; value: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { hour12: false })
}

export function ClientConfig() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [draftValue, setDraftValue] = useState('')

  const {
    data: configs = [],
    isLoading: loadingConfigs,
    isError: errorConfigs,
  } = useQuery({
    queryKey: configKeys.all,
    queryFn: listClientConfig,
  })

  const {
    data: ports = [],
    isLoading: loadingPorts,
    isError: errorPorts,
  } = useQuery({
    queryKey: configKeys.ports,
    queryFn: listClientPorts,
  })

  const mutation = useMutation({
    mutationFn: ({ key, value }: EditState) => updateClientConfig(key, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configKeys.all })
      setEditing(null)
    },
  })

  function openEdit(row: ClientConfigRow) {
    setEditing({ key: row.key, value: row.value })
    setDraftValue(row.value)
  }

  function handleSave() {
    if (!editing) return
    mutation.mutate({ key: editing.key, value: draftValue })
  }

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Client Config</h2>
        <p className='text-muted-foreground'>
          Quản lý cấu hình toàn cục phân phối cho Tailscale client — proxy, PAC,
          route, metrics.
        </p>
      </div>

      <Tabs defaultValue='config'>
        <TabsList>
          <TabsTrigger value='config'>Config</TabsTrigger>
          <TabsTrigger value='ports'>Ports</TabsTrigger>
        </TabsList>

        {/* Config tab */}
        <TabsContent value='config' className='mt-4'>
          {errorConfigs ? (
            <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
              Không tải được danh sách config. Kiểm tra backend
              (/api/client-config).
            </div>
          ) : loadingConfigs ? (
            <div className='text-sm text-muted-foreground'>Đang tải…</div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-48'>Key</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className='w-64'>Note</TableHead>
                    <TableHead className='w-44'>Updated</TableHead>
                    <TableHead className='w-20'></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className='text-center text-sm text-muted-foreground'
                      >
                        Chưa có dữ liệu
                      </TableCell>
                    </TableRow>
                  ) : (
                    configs.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className='font-mono text-sm'>
                          {row.key}
                        </TableCell>
                        <TableCell className='max-w-xs truncate font-mono text-sm'>
                          {row.value}
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {row.note ?? '—'}
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {formatDate(row.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Ports tab */}
        <TabsContent value='ports' className='mt-4'>
          {errorPorts ? (
            <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
              Không tải được danh sách ports. Kiểm tra backend
              (/api/client-config/ports).
            </div>
          ) : loadingPorts ? (
            <div className='text-sm text-muted-foreground'>Đang tải…</div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className='w-36'>SOCKS5 Port</TableHead>
                    <TableHead className='w-36'>HTTP Port</TableHead>
                    <TableHead className='w-44'>Last Reported</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ports.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className='text-center text-sm text-muted-foreground'
                      >
                        Chưa có dữ liệu
                      </TableCell>
                    </TableRow>
                  ) : (
                    ports.map((p) => (
                      <TableRow key={p.client}>
                        <TableCell className='font-mono text-sm'>
                          {p.client}
                        </TableCell>
                        <TableCell className='text-sm'>
                          {p.portSocks5 ?? '—'}
                        </TableCell>
                        <TableCell className='text-sm'>
                          {p.portHttp ?? '—'}
                        </TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {formatDate(p.reportedAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              Edit{' '}
              <span className='font-mono text-primary'>{editing?.key}</span>
            </DialogTitle>
          </DialogHeader>
          <div className='py-2'>
            <Textarea
              className='font-mono text-sm'
              rows={6}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder='Nhập giá trị…'
            />
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setEditing(null)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
          {mutation.isError && (
            <p className='mt-1 text-sm text-destructive'>
              Lỗi:{' '}
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'Unknown error'}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Main>
  )
}
