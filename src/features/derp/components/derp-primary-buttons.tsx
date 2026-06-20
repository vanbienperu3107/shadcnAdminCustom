import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { derpKeys } from '../data/derp-api'
import { useDerp } from './derp-provider'

export function DerpPrimaryButtons() {
  const { setOpen } = useDerp()
  const qc = useQueryClient()
  return (
    <div className='flex gap-2'>
      <Button
        variant='outline'
        size='sm'
        onClick={() => qc.invalidateQueries({ queryKey: derpKeys.all })}
      >
        <RefreshCw className='me-1 size-4' /> Làm mới
      </Button>
      <Button size='sm' onClick={() => setOpen('add')}>
        <Plus className='me-1 size-4' /> Triển khai node mới
      </Button>
    </div>
  )
}
