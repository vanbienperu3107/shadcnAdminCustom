import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Main } from '@/components/layout/main'
import { fetchAcl, hsKeys, updateAcl } from '@/features/headscale/hs-api'
import { ErrorBox, NotConfigured } from '@/features/machines'

export function Acl() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: hsKeys.acl,
    queryFn: fetchAcl,
  })

  // editedPolicy=null means no local edits; fall back to server value.
  const [editedPolicy, setEditedPolicy] = useState<string | null>(null)
  const policy = editedPolicy ?? data?.policy ?? ''
  const dirty = editedPolicy !== null

  const saveMut = useMutation({
    mutationFn: () => updateAcl(policy),
    onSuccess: () => {
      toast.success('Đã lưu ACL policy')
      void qc.invalidateQueries({ queryKey: hsKeys.acl })
      setEditedPolicy(null)
    },
    onError: (e: Error) => toast.error(`Lỗi: ${e.message}`),
  })

  return (
    <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
      <div className='flex items-start justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>ACL Policy</h2>
          <p className='text-muted-foreground'>
            Chính sách kiểm soát truy cập tailnet (HuJSON). Lưu để áp dụng ngay.
          </p>
        </div>
        <Button
          size='sm'
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !dirty || isLoading}
        >
          <Save className='mr-2 h-4 w-4' />
          {saveMut.isPending ? 'Đang lưu…' : 'Lưu'}
          {dirty && !saveMut.isPending && (
            <span className='ms-1.5 inline-block h-2 w-2 rounded-full bg-amber-400' />
          )}
        </Button>
      </div>

      {isError ? (
        <ErrorBox />
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Đang tải…</p>
      ) : !data?.configured ? (
        <NotConfigured />
      ) : (
        <div className='flex flex-1 flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-muted-foreground'>
              HuJSON — comments và trailing commas được phép
            </span>
            {dirty && (
              <span className='text-xs text-amber-500'>
                Có thay đổi chưa lưu
              </span>
            )}
          </div>
          <textarea
            className='min-h-[60vh] w-full resize-y rounded-md border bg-muted/30 p-4 font-mono text-sm leading-relaxed outline-none focus:ring-1 focus:ring-ring'
            value={policy}
            onChange={(e) => setEditedPolicy(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}
    </Main>
  )
}
