import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteDerp, derpKeys } from '../data/derp-api'
import { type DerpServer } from '../data/schema'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow: DerpServer
}

export function DerpDeleteDialog({ open, onOpenChange, currentRow }: Props) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: () => deleteDerp(currentRow.regionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: derpKeys.all })
      toast.success('Đã xóa node DERP')
      onOpenChange(false)
    },
    onError: () => toast.error('Xóa thất bại'),
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className='text-destructive'>
            Xóa node DERP?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Region <b>{currentRow.regionId}</b> · {currentRow.code} (
            {currentRow.hostname}) sẽ bị xóa khỏi database và biến mất khỏi{' '}
            <span className='font-mono'>derpmap.json</span>. Client đang dùng
            node này sẽ tự chuyển sang node khác. Hành động không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Hủy</AlertDialogCancel>
          <AlertDialogAction
            className='bg-destructive text-white hover:bg-destructive/90'
            onClick={(e) => {
              e.preventDefault()
              mut.mutate()
            }}
            disabled={mut.isPending}
          >
            Xóa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
