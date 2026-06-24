import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  createDerp,
  derpKeys,
  getNextRegionId,
  updateDerp,
} from '../data/derp-api'
import {
  DERP_FORM_DEFAULTS,
  derpFormSchema,
  type DerpFormValues,
  type DerpServer,
} from '../data/schema'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: DerpServer | null
}

export function DerpActionDialog({ open, onOpenChange, currentRow }: Props) {
  const isEdit = !!currentRow
  const qc = useQueryClient()

  const form = useForm<DerpFormValues>({
    resolver: zodResolver(derpFormSchema),
    defaultValues: DERP_FORM_DEFAULTS,
  })

  // Preview region_id sẽ được cấp (chỉ khi thêm mới)
  const { data: nextRegionId } = useQuery({
    queryKey: derpKeys.nextRegionId,
    queryFn: getNextRegionId,
    enabled: open && !isEdit,
  })

  useEffect(() => {
    if (!open) return
    if (currentRow) {
      form.reset({
        name: currentRow.name,
        code: currentRow.code,
        nodeName: currentRow.nodeName,
        hostname: currentRow.hostname,
        ipv4: currentRow.ipv4 ?? '',
        derpPort: String(currentRow.derpPort),
        stunPort: String(currentRow.stunPort),
        canPort80: currentRow.canPort80,
        priority: String(currentRow.priority),
      })
    } else {
      form.reset(DERP_FORM_DEFAULTS)
    }
  }, [open, currentRow, form])

  const mutation = useMutation<DerpServer | undefined, unknown, DerpFormValues>({
    mutationFn: (values: DerpFormValues) =>
      isEdit ? updateDerp(currentRow!.regionId, values) : createDerp(values),
    onSuccess: (updatedRow) => {
      // Cập nhật cache ngay lập tức bằng dữ liệu server trả về,
      // không chờ invalidateQueries hoàn thành refetch.
      if (updatedRow) {
        qc.setQueryData<DerpServer[]>(derpKeys.all, (old) =>
          old
            ? old.some((r) => r.regionId === updatedRow.regionId)
              ? old.map((r) => r.regionId === updatedRow.regionId ? updatedRow : r)
              : [...old, updatedRow]
            : [updatedRow]
        )
      }
      qc.invalidateQueries({ queryKey: derpKeys.all })
      toast.success(
        isEdit
          ? 'Đã cập nhật node DERP'
          : 'Đã thêm node DERP — không cần reload'
      )
      onOpenChange(false)
    },
    onError: (err: unknown) => {
      const errObj = err as {
        response?: { status?: number; data?: { error?: string; message?: string } }
        message?: string
      }
      const status = errObj?.response?.status
      const serverMsg = errObj?.response?.data?.message ?? errObj?.response?.data?.error
      const msg = serverMsg
        ? `Lưu thất bại (${status ?? '?'}): ${serverMsg}`
        : `Lưu thất bại${status ? ` (${status})` : ''}: ${errObj?.message ?? 'lỗi không xác định'}`
      toast.error(msg)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Sửa node DERP' : 'Thêm node DERP mới'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Region ${currentRow?.regionId} · ${currentRow?.code}`
              : 'Region ID được cấp tự động (không trùng). Lưu xong client tự nhận map mới.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id='derp-form'
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className='grid grid-cols-2 gap-4'
          >
            {!isEdit && (
              <FormItem className='col-span-2'>
                <FormLabel>Region ID · tự gán</FormLabel>
                <Input
                  readOnly
                  value={nextRegionId ?? '…'}
                  className='bg-muted text-muted-foreground'
                />
              </FormItem>
            )}

            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem className='col-span-2'>
                  <FormLabel>Tên region</FormLabel>
                  <FormControl>
                    <Input placeholder='VPN7 Vietnam' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='code'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Region code</FormLabel>
                  <FormControl>
                    <Input placeholder='vpn7-vn' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='nodeName'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên node</FormLabel>
                  <FormControl>
                    <Input placeholder='vpn7-vn-1' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='hostname'
              render={({ field }) => (
                <FormItem className='col-span-2'>
                  <FormLabel>Hostname (FQDN)</FormLabel>
                  <FormControl>
                    <Input placeholder='vpn7.hangocthanh.io.vn' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='ipv4'
              render={({ field }) => (
                <FormItem className='col-span-2'>
                  <FormLabel>IPv4 (tùy chọn)</FormLabel>
                  <FormControl>
                    <Input placeholder='203.0.113.10' {...field} />
                  </FormControl>
                  <FormDescription>
                    Bỏ trống để dùng DNS. Nhập "none" để tắt IPv4.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='derpPort'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>DERP port</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='stunPort'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>STUN port (-1 = tắt)</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='priority'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Độ ưu tiên</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} />
                  </FormControl>
                  <FormDescription>
                    Số nhỏ = ưu tiên cao (100 = trung tính).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='canPort80'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between rounded-md border p-3'>
                  <FormLabel className='mb-0'>Cho phép HTTP port 80</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type='submit' form='derp-form' disabled={mutation.isPending}>
            {isEdit ? 'Lưu' : 'Thêm node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
