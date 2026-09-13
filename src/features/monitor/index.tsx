import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'

const STATUS_URL = 'https://status.hangocthanh.io.vn'

// Nhúng Beszel (CPU/RAM/disk vpn4+vpn6). Đăng nhập nhờ SSO: cookie phiên CMS
// dùng chung .hangocthanh.io.vn, Caddy forward_auth kiểm (docs/status-sso.md).
export function MonitorPage() {
  return (
    <Main className='flex flex-1 flex-col gap-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Monitor</h2>
          <p className='text-muted-foreground'>
            Tài nguyên máy chủ vpn4 &amp; vpn6 (Beszel).
          </p>
        </div>
        <Button variant='outline' asChild>
          <a href={STATUS_URL} target='_blank' rel='noopener noreferrer'>
            <ExternalLink /> Mở tab mới
          </a>
        </Button>
      </div>
      <iframe
        title='Beszel monitor'
        src={STATUS_URL}
        className='min-h-[75vh] w-full flex-1 rounded-lg border'
      />
    </Main>
  )
}
