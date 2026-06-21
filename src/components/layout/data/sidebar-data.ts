import {
  Activity,
  Flame,
  LayoutDashboard,
  Map,
  Network,
  Rocket,
  Server,
  Users,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Headscale Admin',
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
  navGroups: [
    {
      title: 'Headscale',
      items: [
        { title: 'Overview', url: '/overview', icon: LayoutDashboard },
        { title: 'Machines', url: '/machines', icon: Server },
        { title: 'Users', url: '/tailnet-users', icon: Users },
        { title: 'Latency', url: '/latency', icon: Activity },
        { title: 'DERP Regions', url: '/derp', icon: Network },
        { title: 'Force Routes', url: '/force-routes', icon: Flame },
        { title: 'Node Assignments', url: '/node-assignments', icon: Map },
        { title: 'Deploy & CI', url: '/deploy', icon: Rocket },
      ],
    },
  ],
}
