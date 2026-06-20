import { useQuery } from '@tanstack/react-query'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { DerpDialogs } from './components/derp-dialogs'
import { DerpPrimaryButtons } from './components/derp-primary-buttons'
import { DerpProvider } from './components/derp-provider'
import { DerpTable } from './components/derp-table'
import { derpKeys, listDerp } from './data/derp-api'

export function Derp() {
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: derpKeys.all,
    queryFn: listDerp,
  })

  return (
    <DerpProvider>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>DERP Regions</h2>
            <p className='text-muted-foreground'>
              Quản lý node DERP — bật/tắt, thêm, xóa, tạm dừng, đặt ưu tiên.
              Client tự phát hiện và chuyển node, không cần reload.
            </p>
          </div>
          <DerpPrimaryButtons />
        </div>

        {isError ? (
          <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
            Không tải được danh sách DERP. Kiểm tra backend (`/api/derp`) đã
            chạy chưa.
          </div>
        ) : isLoading ? (
          <div className='text-sm text-muted-foreground'>Đang tải…</div>
        ) : (
          <DerpTable data={data} />
        )}
      </Main>

      <DerpDialogs />
    </DerpProvider>
  )
}
