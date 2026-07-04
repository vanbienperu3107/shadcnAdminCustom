import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { fetchMe } from '@/lib/auth-api'
import { ContentSection } from '../components/content-section'
import { ChangePasswordForm } from './change-password-form'
import { TwoFactorCard } from './two-factor-card'

export function SettingsSecurity() {
  const [loading, setLoading] = useState(true)
  const [totpEnabled, setTotpEnabled] = useState(false)
  // Tài khoản nội bộ mới có mật khẩu để đổi; user chỉ đăng nhập Google thì ẩn.
  const [hasPassword, setHasPassword] = useState(false)

  useEffect(() => {
    let alive = true
    fetchMe().then((me) => {
      if (!alive) return
      setTotpEnabled(!!me?.totpEnabled)
      setHasPassword(!!me?.username)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <ContentSection
      title='Bảo mật'
      desc='Quản lý mật khẩu và xác thực 2 lớp (2FA) cho tài khoản admin.'
    >
      {loading ? (
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='size-4 animate-spin' /> Đang tải…
        </div>
      ) : !hasPassword ? (
        <div className='rounded-lg border p-4 text-sm text-muted-foreground'>
          Tài khoản này đăng nhập qua Google nên không có mật khẩu hay 2FA nội
          bộ để cấu hình.
        </div>
      ) : (
        <div className='grid gap-6'>
          <TwoFactorCard enabled={totpEnabled} onChanged={setTotpEnabled} />
          <ChangePasswordForm />
        </div>
      )}
    </ContentSection>
  )
}
