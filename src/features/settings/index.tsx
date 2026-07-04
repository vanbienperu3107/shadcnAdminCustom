import { Outlet } from '@tanstack/react-router'
import { Separator } from '@/components/ui/separator'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export function Settings() {
  return (
    <>
      {/* ===== Top Heading ===== */}
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Cài đặt tài khoản
          </h1>
          <p className='text-muted-foreground'>
            Quản lý mật khẩu và xác thực 2 lớp (2FA) cho tài khoản admin.
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex w-full overflow-y-hidden p-1'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}
