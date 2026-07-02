import { LayoutDashboard, Network, Rocket, Server, Users } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'DERP-Controller Admin',
    email: 'admin@hangocthanh.io.vn',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Votam admin controller',
      logo: Network,
      plan: 'hangocthanh.io.vn',
    },
  ],
  // 13 trang cũ gộp còn 4 (2026-07): Overview, Tailnet Access (Users/ACL/
  // Pre-auth Keys/Node Runtime/PAC Rules/Client Config), Machines (Machines/
  // Routes/DERP Regions/Force Routes/Node Assignments/Latency), Deploy & CI.
  // Chỉ 4 mục nên không cần chia nhóm collapsible nữa.
  navGroups: [
    {
      title: 'DERP-Controller',
      items: [
        { title: 'Overview', url: '/overview', icon: LayoutDashboard },
        { title: 'Tailnet Access', url: '/tailnet-access', icon: Users },
        { title: 'Machines', url: '/machines', icon: Server },
        { title: 'Deploy & CI', url: '/deploy', icon: Rocket },
      ],
    },
  ],
}
