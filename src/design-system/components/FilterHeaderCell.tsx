import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CaretDown, X } from '@phosphor-icons/react'

export type FilterMenuOption<T extends string | number> = {
  value: T
  label: string
  color?: string
}

/** Cột header có thể mở dropdown lọc ngay tại chỗ, kèm badge + nút X khi khác baseline. */
export function FilterHeaderCell<T extends string | number>({
  label,
  options,
  value,
  baseline,
  onChange,
  menuLabel,
  clearLabel,
  as = 'div',
}: {
  label: string
  options: FilterMenuOption<T>[]
  value: T
  baseline: T
  onChange: (value: T) => void
  menuLabel: string
  clearLabel: string
  /** 'div' (role="columnheader", cho grid header) hoặc 'th' (cho bảng &lt;table&gt; chuẩn). */
  as?: 'div' | 'th'
}): ReactNode {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)
  const setRootRef = (node: HTMLElement | null) => {
    rootRef.current = node
  }
  const selected = value !== baseline ? options.find((option) => option.value === value) : undefined

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const children = (
    <>
      <button
        type="button"
        className="ds-filter-header__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <span className="ds-filter-header__caret" aria-hidden="true">
          <CaretDown size={10} weight="bold" />
        </span>
      </button>
      {selected ? (
        <span className="ds-filter-header__badge" style={selected.color ? { color: selected.color } : undefined}>
          <span>{selected.label}</span>
          <button
            type="button"
            className="ds-filter-header__badge-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={(event) => {
              event.stopPropagation()
              onChange(baseline)
            }}
          >
            <X size={10} weight="bold" aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {open ? (
        <div className="ds-filter-header__menu" role="menu" aria-label={menuLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className={value === option.value ? 'is-active' : undefined}
              style={option.color ? { color: option.color } : undefined}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )

  if (as === 'th') {
    return (
      <th>
        <div className="ds-filter-header" ref={setRootRef}>
          {children}
        </div>
      </th>
    )
  }
  return (
    <div role="columnheader" className="ds-filter-header" ref={setRootRef}>
      {children}
    </div>
  )
}
