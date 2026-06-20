import { useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { googleLoginUrl } from '@/lib/auth-api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'Email của bạn không nằm trong danh sách được phép.',
  email_unverified: 'Email Google chưa được xác minh.',
  invalid_state: 'Phiên đăng nhập không hợp lệ, vui lòng thử lại.',
  oauth_failed: 'Đăng nhập Google thất bại, vui lòng thử lại.',
  google_oauth_not_configured: 'Server chưa cấu hình Google OAuth.',
}

export function SignIn() {
  const { error } = useSearch({ from: '/(auth)/sign-in' })

  useEffect(() => {
    if (error) toast.error(ERROR_MESSAGES[error] ?? 'Đăng nhập thất bại')
  }, [error])

  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>Đăng nhập</CardTitle>
          <CardDescription>
            Headscale Admin — dùng tài khoản Google được cấp quyền để tiếp tục.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className='w-full'
            onClick={() => {
              window.location.href = googleLoginUrl()
            }}
          >
            <GoogleIcon />
            Đăng nhập với Google
          </Button>
        </CardContent>
        <CardFooter>
          <p className='px-4 text-center text-xs text-muted-foreground'>
            Chỉ các email trong danh sách{' '}
            <span className='font-mono'>ALLOWED_EMAILS</span> mới đăng nhập
            được.
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}

function GoogleIcon() {
  return (
    <svg className='size-4' viewBox='0 0 24 24' aria-hidden='true'>
      <path
        fill='#4285F4'
        d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z'
      />
      <path
        fill='#34A853'
        d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z'
      />
      <path
        fill='#FBBC05'
        d='M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z'
      />
      <path
        fill='#EA4335'
        d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z'
      />
    </svg>
  )
}
