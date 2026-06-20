import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, Loader2, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { derpKeys, type ProbeResult } from '../data/derp-api'
import { useDerp } from './derp-provider'

export function DerpPrimaryButtons() {
  const { setOpen } = useDerp()
  const qc = useQueryClient()
  const [probing, setProbing] = useState(false)

  // Probe lại health THẬT: refetch /api/derp/health + spinner + toast thông báo.
  const handleProbe = async () => {
    setProbing(true)
    const t = toast.loading('Đang probe health các node DERP…')
    try {
      await qc.refetchQueries({ queryKey: derpKeys.health })
      const data = qc.getQueryData<ProbeResult[]>(derpKeys.health) ?? []
      const up = data.filter((d) => d.up).length
      toast.success(
        `Đã probe ${data.length} node — ${up} sống, ${data.length - up} chết`,
        { id: t }
      )
    } catch {
      toast.error('Probe thất bại', { id: t })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className='flex gap-2'>
      <Button
        variant='outline'
        size='sm'
        onClick={() => qc.invalidateQueries({ queryKey: derpKeys.all })}
      >
        <RefreshCw className='me-1 size-4' /> Làm mới
      </Button>
      <Button
        variant='outline'
        size='sm'
        onClick={handleProbe}
        disabled={probing}
      >
        {probing ? (
          <Loader2 className='me-1 size-4 animate-spin' />
        ) : (
          <Activity className='me-1 size-4' />
        )}
        Probe lại
      </Button>
      <Button size='sm' onClick={() => setOpen('add')}>
        <Plus className='me-1 size-4' /> Triển khai node mới
      </Button>
    </div>
  )
}
