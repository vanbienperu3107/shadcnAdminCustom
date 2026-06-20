import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Main } from '@/components/layout/main'
import { DashHeader } from '@/components/layout/page-header'
import { type CiRun, fetchCi, hsKeys } from '@/features/headscale/hs-api'

function StatusBadge({ run }: { run: CiRun }) {
  if (run.status !== 'completed') {
    return (
      <Badge
        variant='outline'
        className='border-blue-500/40 text-blue-600 dark:text-blue-400'
      >
        <span className='me-1 inline-block size-2 animate-pulse rounded-full bg-blue-500' />
        {run.status}
      </Badge>
    )
  }
  if (run.conclusion === 'success') {
    return (
      <Badge
        variant='outline'
        className='border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
      >
        ✓ success
      </Badge>
    )
  }
  if (run.conclusion === 'skipped' || run.conclusion === 'cancelled') {
    return (
      <Badge
        variant='outline'
        className='border-muted-foreground/30 text-muted-foreground'
      >
        {run.conclusion}
      </Badge>
    )
  }
  return (
    <Badge variant='outline' className='border-destructive/40 text-destructive'>
      ✗ {run.conclusion ?? 'failed'}
    </Badge>
  )
}

export function CiDeploy() {
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.ci,
    queryFn: fetchCi,
    refetchInterval: 30_000,
  })

  return (
    <>
      <DashHeader />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Deploy &amp; CI</h2>
          <p className='text-muted-foreground'>
            GitHub Actions runs gần nhất (shadcnAdminCustom + deployHeadscale).
            Tự làm mới 30s.
          </p>
        </div>

        {isError || data?.error ? (
          <div className='rounded-md border border-destructive/40 p-4 text-sm text-destructive'>
            Không gọi được GitHub API (kiểm tra GITHUB_TOKEN / scope
            actions:read).
          </div>
        ) : isLoading ? (
          <p className='text-sm text-muted-foreground'>Đang tải…</p>
        ) : !data?.configured ? (
          <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm'>
            Chưa cấu hình <span className='font-mono'>GITHUB_TOKEN</span> (PAT
            read actions) — thêm secret rồi deploy lại.
          </div>
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Repo</TableHead>
                  <TableHead>Nhánh</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Kết quả</TableHead>
                  <TableHead>Thời gian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className='h-24 text-center'>
                      Chưa có run nào.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.runs.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className='font-medium'>
                        <a
                          href={r.htmlUrl}
                          target='_blank'
                          rel='noreferrer'
                          className='hover:underline'
                        >
                          {r.name}
                        </a>
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {r.repo.split('/')[1] ?? r.repo}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {r.headBranch}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {r.event}
                      </TableCell>
                      <TableCell>
                        <StatusBadge run={r} />
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {r.createdAt
                          ? new Date(r.createdAt).toLocaleString()
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}
