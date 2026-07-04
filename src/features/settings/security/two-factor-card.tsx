import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { disable2fa, enable2fa, setup2fa, type TotpSetup } from '@/lib/auth-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { PasswordInput } from '@/components/password-input'

const codeSchema = z.object({
  code: z.string().min(6, 'Nhập đủ 6 chữ số.').max(6, 'Nhập đủ 6 chữ số.'),
})
const disableSchema = z.object({
  password: z.string().min(1, 'Nhập mật khẩu để xác nhận.'),
})

type TwoFactorCardProps = {
  enabled: boolean
  onChanged: (enabled: boolean) => void
}

export function TwoFactorCard({ enabled, onChanged }: TwoFactorCardProps) {
  const [setupData, setSetupData] = useState<TotpSetup | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Sinh ảnh QR từ otpauth URI để quét bằng app authenticator.
  const otpauthUri = setupData?.otpauthUri
  useEffect(() => {
    if (!otpauthUri) return
    let alive = true
    QRCode.toDataURL(otpauthUri, { margin: 1, width: 200 })
      .then((url) => alive && setQrDataUrl(url))
      .catch(() => alive && setQrDataUrl(null))
    return () => {
      alive = false
    }
  }, [otpauthUri])

  const enableForm = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  })
  const disableForm = useForm<z.infer<typeof disableSchema>>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: '' },
  })

  async function startSetup() {
    setBusy(true)
    try {
      setSetupData(await setup2fa())
      enableForm.reset({ code: '' })
    } catch {
      toast.error('Không tạo được mã cài đặt 2FA.')
    } finally {
      setBusy(false)
    }
  }

  async function onEnable(data: z.infer<typeof codeSchema>) {
    if (!setupData) return
    setBusy(true)
    try {
      await enable2fa(setupData.secret, data.code)
      toast.success('Đã bật xác thực 2 lớp.')
      setSetupData(null)
      setQrDataUrl(null)
      onChanged(true)
    } catch {
      toast.error('Mã không đúng, thử lại.')
      enableForm.reset({ code: '' })
    } finally {
      setBusy(false)
    }
  }

  async function onDisable(data: z.infer<typeof disableSchema>) {
    setBusy(true)
    try {
      await disable2fa(data.password)
      toast.success('Đã tắt xác thực 2 lớp.')
      disableForm.reset({ password: '' })
      onChanged(false)
    } catch {
      toast.error('Mật khẩu không đúng.')
    } finally {
      setBusy(false)
    }
  }

  if (enabled) {
    return (
      <div className='rounded-lg border p-4'>
        <div className='mb-3 flex items-center gap-2'>
          <ShieldCheck className='size-5 text-emerald-600' />
          <span className='font-medium'>Xác thực 2 lớp (TOTP)</span>
          <Badge variant='secondary'>Đang bật</Badge>
        </div>
        <p className='mb-4 text-sm text-muted-foreground'>
          Nhập mật khẩu để tắt xác thực 2 lớp cho tài khoản này.
        </p>
        <Form {...disableForm}>
          <form
            onSubmit={disableForm.handleSubmit(onDisable)}
            className='grid gap-3'
          >
            <FormField
              control={disableForm.control}
              name='password'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mật khẩu</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete='current-password' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type='submit' variant='destructive' disabled={busy}>
              {busy ? <Loader2 className='animate-spin' /> : <ShieldOff />}
              Tắt 2FA
            </Button>
          </form>
        </Form>
      </div>
    )
  }

  return (
    <div className='rounded-lg border p-4'>
      <div className='mb-3 flex items-center gap-2'>
        <ShieldOff className='size-5 text-muted-foreground' />
        <span className='font-medium'>Xác thực 2 lớp (TOTP)</span>
        <Badge variant='outline'>Chưa bật</Badge>
      </div>

      {!setupData ? (
        <>
          <p className='mb-4 text-sm text-muted-foreground'>
            Bảo vệ tài khoản bằng mã một lần từ ứng dụng xác thực (Google
            Authenticator, Authy, 1Password…).
          </p>
          <Button onClick={startSetup} disabled={busy}>
            {busy ? <Loader2 className='animate-spin' /> : <ShieldCheck />}
            Bật 2FA
          </Button>
        </>
      ) : (
        <div className='grid gap-4'>
          <div className='grid gap-2'>
            <p className='text-sm text-muted-foreground'>
              1. Mở app xác thực (Google Authenticator, Authy, 1Password…) và{' '}
              <b>quét mã QR</b> dưới đây:
            </p>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt='QR cấu hình 2FA'
                width={200}
                height={200}
                className='rounded-md border bg-white p-2'
              />
            ) : (
              <div className='flex size-[200px] items-center justify-center rounded-md border'>
                <Loader2 className='animate-spin text-muted-foreground' />
              </div>
            )}
            <p className='text-xs text-muted-foreground'>
              Không quét được? Nhập tay khóa này:
            </p>
            <code className='rounded bg-muted px-2 py-1 font-mono text-sm break-all'>
              {setupData.secret}
            </code>
          </div>
          <Form {...enableForm}>
            <form
              onSubmit={enableForm.handleSubmit(onEnable)}
              className='grid gap-3'
            >
              <FormField
                control={enableForm.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>2. Nhập mã 6 chữ số để xác nhận</FormLabel>
                    <FormControl>
                      <InputOTP maxLength={6} {...field}>
                        <InputOTPGroup>
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className='flex gap-2'>
                <Button type='submit' disabled={busy}>
                  {busy && <Loader2 className='animate-spin' />}
                  Xác nhận & bật
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    setSetupData(null)
                    setQrDataUrl(null)
                  }}
                >
                  Hủy
                </Button>
              </div>
            </form>
          </Form>
        </div>
      )}
    </div>
  )
}
