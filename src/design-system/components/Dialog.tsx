import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { X } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { IconButton } from './IconButton'

export type DialogProps = {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  closeLabel?: string
  onClose: () => void
}

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeLabel = 'Đóng hộp thoại',
  onClose,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) return
      const controls = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (controls.length === 0) return

      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="ds-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCloseRef.current()
      }}
    >
      <div
        ref={panelRef}
        className={`ds-dialog ds-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="ds-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton type="button" label={closeLabel} icon={<X size={20} weight="bold" aria-hidden="true" />} onClick={() => onCloseRef.current()} />
        </header>
        <div className="ds-dialog__body">{children}</div>
        {footer ? <footer className="ds-dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
