import { Outlet } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'

// Bỏ thanh header trên cùng (Search + theme + avatar) — thừa và trùng với menu
// ở footer sidebar; các trang DERP khác cũng không có. Tiêu đề trang do
// ContentSection của trang con (Bảo mật/2FA) đảm nhiệm.
export function Settings() {
  return (
    <Main fixed>
      <div className='flex w-full overflow-y-hidden p-1'>
        <Outlet />
      </div>
    </Main>
  )
}
