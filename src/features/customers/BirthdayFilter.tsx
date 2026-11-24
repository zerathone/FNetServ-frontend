import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Cake, CaretDown, Check } from '@phosphor-icons/react'
import type { BirthdayMonthOption } from './birthdayModel'

/** Lựa chọn của bộ lọc: 'week' = tuần hiện tại (T2..CN); số 1..12 = tháng đó. */
export type BirthdayChoice = 'week' | number

type Props = {
  /** Đang lọc danh sách hay chưa (nút bấm bật/tắt). */
  active: boolean
  choice: BirthdayChoice
  /** Số tài khoản có sinh nhật tuần này (tab đang xem). */
  weekCount: number
  /** 12 tháng, bắt đầu từ tháng hiện tại rồi tăng dần (xem `birthdayMonthOptions`). */
  months: BirthdayMonthOption[]
  onToggle: () => void
  /** Chọn một mục trong danh sách ⇒ đổi lựa chọn VÀ bật lọc. */
  onChoose: (choice: BirthdayChoice) => void
}

const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

/**
 * Một nút chia đôi gom "Sinh nhật tuần này" và "Sinh nhật theo tháng":
 *  - nửa trái: biểu tượng bánh + nhãn của lựa chọn hiện tại + số lượng; bấm = bật/tắt lọc;
 *  - nửa phải (mũi tên): mở danh sách Tuần này → Tháng hiện tại → các tháng kế tiếp (tăng dần, 12 tháng).
 */
export function BirthdayFilter({ active, choice, weekCount, months, onToggle, onChoose }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const caretRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const selectedMonth = typeof choice === 'number' ? months.find((option) => option.month === choice) : undefined
  const label = choice === 'week' ? 'Sinh nhật tuần' : `Sinh nhật tháng ${choice}`
  const count = choice === 'week' ? weekCount : (selectedMonth?.count ?? 0)

  // Đóng khi bấm ra ngoài hoặc nhấn Esc (trả focus về mũi tên).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        caretRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (next: BirthdayChoice) => {
    onChoose(next)
    setOpen(false)
    caretRef.current?.focus()
  }

  // Mũi tên lên/xuống di chuyển giữa các mục trong danh sách.
  const moveFocus = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <div ref={rootRef} className={`customer-birthday-filter${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="customer-birthday-filter__main"
        aria-pressed={active}
        disabled={!active && count === 0}
        title={
          !active && count === 0
            ? `${choice === 'week' ? 'Tuần này (thứ Hai → Chủ nhật)' : `Tháng ${choice}`} chưa có ai sinh nhật`
            : `Lọc tài khoản có sinh nhật ${choice === 'week' ? 'trong tuần này (thứ Hai → Chủ nhật)' : `trong tháng ${choice}`}`
        }
        onClick={onToggle}
      >
        <Cake size={16} weight="fill" aria-hidden="true" />
        {label}
        <span className="customer-birthday-filter__count">{number(count)}</span>
      </button>
      <button
        ref={caretRef}
        type="button"
        className="customer-birthday-filter__caret"
        aria-label="Chọn tuần hoặc tháng sinh nhật"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>

      {open ? (
        <ul id={menuId} className="customer-birthday-filter__menu" role="menu" aria-label="Sinh nhật theo" onKeyDown={moveFocus}>
          <li role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={choice === 'week'}
              className="customer-birthday-filter__item"
              autoFocus={choice === 'week'}
              onClick={() => choose('week')}
            >
              <span>Tuần này</span>
              <small>thứ Hai → Chủ nhật</small>
              <strong>{number(weekCount)}</strong>
              {choice === 'week' ? <Check size={14} weight="bold" aria-hidden="true" /> : null}
            </button>
          </li>
          <li role="separator" className="customer-birthday-filter__separator" />
          {months.map((option) => (
            <li key={option.month} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={choice === option.month}
                className="customer-birthday-filter__item"
                autoFocus={choice === option.month}
                onClick={() => choose(option.month)}
              >
                <span>{option.label}</span>
                <small>{option.isCurrent ? 'hiện tại' : ''}</small>
                <strong>{number(option.count)}</strong>
                {choice === option.month ? <Check size={14} weight="bold" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
