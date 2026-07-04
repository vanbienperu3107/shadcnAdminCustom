import { Outlet } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

export function Settings() {
  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      {/* Chỉ còn 1 mục (Bảo mật/2FA) nên tiêu đề trang do chính ContentSection
          của trang con đảm nhiệm — không lặp lại heading + mô tả ở đây nữa. */}
      <Main fixed>
        <div className='flex w-full overflow-y-hidden p-1'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}
