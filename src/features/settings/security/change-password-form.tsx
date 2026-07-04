import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { changePassword } from '@/lib/auth-api'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PasswordInput } from '@/components/password-input'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại.'),
    newPassword: z.string().min(8, 'Mật khẩu mới tối thiểu 8 ký tự.'),
    confirmPassword: z.string().min(1, 'Nhập lại mật khẩu mới.'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp.',
    path: ['confirmPassword'],
  })

export function ChangePasswordForm() {
  const [busy, setBusy] = useState(false)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: z.infer<typeof schema>) {
    setBusy(true)
    try {
      await changePassword(data.currentPassword, data.newPassword)
      toast.success('Đã đổi mật khẩu.')
      form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch {
      toast.error('Mật khẩu hiện tại không đúng.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='rounded-lg border p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <KeyRound className='size-5 text-muted-foreground' />
        <span className='font-medium'>Đổi mật khẩu</span>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='grid gap-3'>
          <FormField
            control={form.control}
            name='currentPassword'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mật khẩu hiện tại</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete='current-password' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='newPassword'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mật khẩu mới</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete='new-password' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='confirmPassword'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nhập lại mật khẩu mới</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete='new-password' {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type='submit' disabled={busy} className='w-fit'>
            {busy && <Loader2 className='animate-spin' />}
            Đổi mật khẩu
          </Button>
        </form>
      </Form>
    </div>
  )
}
