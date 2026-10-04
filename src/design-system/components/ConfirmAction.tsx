import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

type ConfirmActionProps = {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  pending?: boolean
  /** Tắt nút xác nhận (vd bắt tick "đã hiểu" trước khi cho hủy đơn đã thu tiền). */
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmAction({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Hủy',
  danger = false,
  pending = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: ConfirmActionProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      size="sm"
      onClose={pending ? () => undefined : onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
