import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearch } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { loginPassword, verifyLogin2fa } from '@/lib/auth-api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp'
import { PasswordInput } from '@/components/password-input'

const loginSchema = z.object({
  username: z.string().min(1, 'Vui lòng nhập tên đăng nhập.'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
})
const otpSchema = z.object({
  code: z.string().min(6, 'Nhập đủ 6 chữ số.').max(6, 'Nhập đủ 6 chữ số.'),
})

type PasswordFormProps = React.HTMLAttributes<HTMLFormElement>

export function PasswordForm({ className, ...props }: PasswordFormProps) {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const [step, setStep] = useState<'login' | '2fa'>('login')
  const [isLoading, setIsLoading] = useState(false)

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })
  const otpForm = useForm<z.infer<typeof otpSchema>>({
    resolver: zodResolver(otpSchema),
    defaultValues: { code: '' },
  })

  function goToApp() {
    const target = redirect && redirect.startsWith('/') ? redirect : '/'
    // Full reload để route guard chạy lại fetchMe() với cookie mới.
    window.location.assign(target)
  }

  async function onLogin(data: z.infer<typeof loginSchema>) {
    setIsLoading(true)
    try {
      const { mfaRequired } = await loginPassword(data.username, data.password)
      if (mfaRequired) {
        setStep('2fa')
        otpForm.reset({ code: '' })
      } else {
        goToApp()
      }
    } catch {
      toast.error('Tên đăng nhập hoặc mật khẩu không đúng.')
    } finally {
      setIsLoading(false)
    }
  }

  async function onVerify(data: z.infer<typeof otpSchema>) {
    setIsLoading(true)
    try {
      await verifyLogin2fa(data.code)
      goToApp()
    } catch {
      toast.error('Mã xác thực không đúng hoặc đã hết hạn.')
      otpForm.reset({ code: '' })
    } finally {
      setIsLoading(false)
    }
  }

  if (step === '2fa') {
    return (
      <Form {...otpForm}>
        <form
          onSubmit={otpForm.handleSubmit(onVerify)}
          className={cn('grid gap-3', className)}
          {...props}
        >
          <p className='text-sm text-muted-foreground'>
            Nhập mã 6 chữ số từ ứng dụng xác thực (Google Authenticator,
            Authy…).
          </p>
          <FormField
            control={otpForm.control}
            name='code'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='sr-only'>Mã 2FA</FormLabel>
                <FormControl>
                  <InputOTP
                    maxLength={6}
                    autoFocus
                    {...field}
                    containerClassName='justify-between sm:[&>[data-slot="input-otp-group"]>div]:w-12'
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button className='mt-2' disabled={isLoading}>
            {isLoading && <Loader2 className='animate-spin' />}
            Xác nhận
          </Button>
          <Button
            type='button'
            variant='ghost'
            className='w-full'
            onClick={() => setStep('login')}
          >
            Quay lại
          </Button>
        </form>
      </Form>
    )
  }

  return (
    <Form {...loginForm}>
      <form
        onSubmit={loginForm.handleSubmit(onLogin)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={loginForm.control}
          name='username'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tên đăng nhập</FormLabel>
              <FormControl>
                <Input placeholder='admin' autoComplete='username' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={loginForm.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mật khẩu</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='••••••••'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Đăng nhập
        </Button>
      </form>
    </Form>
  )
}
