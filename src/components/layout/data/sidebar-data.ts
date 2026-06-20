import { Network } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Headscale Admin',
    email: 'admin@hangocthanh.io.vn',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'Headscale Admin',
      logo: Network,
      plan: 'hangocthanh.io.vn',
    },
  ],
  navGroups: [
    {
      title: 'Headscale',
      items: [
        {
          title: 'DERP Regions',
          url: '/derp',
          icon: Network,
        },
      ],
    },
  ],
}
