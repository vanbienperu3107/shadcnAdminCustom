import {
  Activity,
  FileCode2,
  Flame,
  Key,
  LayoutDashboard,
  Map,
  Network,
  Rocket,
  Route,
  Server,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
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
  navGroups: [
    {
      title: 'DERP-Controller',
      items: [
        { title: 'Overview', url: '/overview', icon: LayoutDashboard },
        { title: 'Machines', url: '/machines', icon: Server },
        { title: 'Users', url: '/tailnet-users', icon: Users },
        { title: 'Routes', url: '/hs-routes', icon: Route },
        { title: 'ACL Policy', url: '/acl', icon: Shield },
        { title: 'Pre-auth Keys', url: '/preauth-keys', icon: Key },
        { title: 'Latency', url: '/latency', icon: Activity },
        { title: 'DERP Regions', url: '/derp', icon: Network },
        { title: 'Force Routes', url: '/force-routes', icon: Flame },
        { title: 'Node Assignments', url: '/node-assignments', icon: Map },
        { title: 'Deploy & CI', url: '/deploy', icon: Rocket },
        { title: 'Client Config', url: '/client-config', icon: SlidersHorizontal },
      ],
    },
  ],
}
