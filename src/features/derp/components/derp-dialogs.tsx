import { DerpActionDialog } from './derp-action-dialog'
import { DerpDeleteDialog } from './derp-delete-dialog'
import { useDerp } from './derp-provider'

export function DerpDialogs() {
  const { open, setOpen, currentRow, setCurrentRow } = useDerp()

  const closeWithCleanup = (next: 'edit' | 'delete', v: boolean) => {
    setOpen(v ? next : null)
    if (!v) setTimeout(() => setCurrentRow(null), 300)
  }

  return (
    <>
      <DerpActionDialog
        key={`add-${open === 'add'}`}
        open={open === 'add'}
        onOpenChange={(v) => setOpen(v ? 'add' : null)}
      />

      {currentRow && (
        <>
          <DerpActionDialog
            key={`edit-${currentRow.regionId}`}
            open={open === 'edit'}
            onOpenChange={(v) => closeWithCleanup('edit', v)}
            currentRow={currentRow}
          />
          <DerpDeleteDialog
            key={`delete-${currentRow.regionId}`}
            open={open === 'delete'}
            onOpenChange={(v) => closeWithCleanup('delete', v)}
            currentRow={currentRow}
          />
        </>
      )}
    </>
  )
}
