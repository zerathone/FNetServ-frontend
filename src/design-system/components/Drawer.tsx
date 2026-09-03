import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { IconButton } from './IconButton'

export type DrawerProps = {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'wide'
  compactHeader?: boolean
  className?: string
  onClose: () => void
}

export function Drawer({
  open,
  title,
  description,
  children,
  footer,
  size = 'default',
  compactHeader = false,
  className = '',
  onClose,
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)

  // An inline onClose callback must not restart focus management on rerender.
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const firstControl = panelRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      ;(firstControl ?? panelRef.current)?.focus()
    })
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
      if (!controls.length) return
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
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="ds-drawer-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onCloseRef.current()
      }}
    >
      <aside
        ref={panelRef}
        className={`ds-drawer ds-drawer--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className={`ds-drawer__header${compactHeader ? ' ds-drawer__header--compact' : ''}`}>
          {compactHeader ? (
            <>
              <IconButton
                type="button"
                label="Đóng bảng chi tiết"
                icon={<X size={20} weight="bold" aria-hidden="true" />}
                className="ds-drawer__compact-close"
                onClick={() => onCloseRef.current()}
              />
              <h2 id={titleId} className="ds-visually-hidden">{title}</h2>
            </>
          ) : (
            <>
              <div>
                <h2 id={titleId}>{title}</h2>
                {description ? <p id={descriptionId}>{description}</p> : null}
              </div>
              <IconButton
                type="button"
                label="Đóng bảng chi tiết"
                icon={<X size={20} weight="bold" aria-hidden="true" />}
                onClick={() => onCloseRef.current()}
              />
            </>
          )}
        </header>
        <div className="ds-drawer__body">{children}</div>
        {footer ? <footer className="ds-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  )
}
