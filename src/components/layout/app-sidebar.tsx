import { useQuery } from '@tanstack/react-query'
import { fetchMe } from '@/lib/auth-api'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  // Hiện đúng tài khoản Google đang đăng nhập (thay user demo).
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe })
  const user = me
    ? {
        name: me.name ?? me.email,
        email: me.email,
        avatar: me.picture ?? sidebarData.user.avatar,
      }
    : sidebarData.user
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
