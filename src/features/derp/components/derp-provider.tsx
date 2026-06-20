import React, { useState } from 'react'
import useDialogState from '@/hooks/use-dialog-state'
import { type DerpServer } from '../data/schema'

type DerpDialogType = 'add' | 'edit' | 'delete'

type DerpContextType = {
  open: DerpDialogType | null
  setOpen: (str: DerpDialogType | null) => void
  currentRow: DerpServer | null
  setCurrentRow: React.Dispatch<React.SetStateAction<DerpServer | null>>
}

const DerpContext = React.createContext<DerpContextType | null>(null)

export function DerpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<DerpDialogType>(null)
  const [currentRow, setCurrentRow] = useState<DerpServer | null>(null)

  return (
    <DerpContext value={{ open, setOpen, currentRow, setCurrentRow }}>
      {children}
    </DerpContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useDerp = () => {
  const ctx = React.useContext(DerpContext)
  if (!ctx) throw new Error('useDerp phải dùng trong <DerpProvider>')
  return ctx
}
