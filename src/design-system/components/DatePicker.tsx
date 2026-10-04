import { CalendarBlank, CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

/**
 * Chọn MỘT ngày (hoặc ngày giờ) theo kiểu Ant Design DatePicker: ô nhập gõ được
 * dd/mm/yyyy, popup lịch, bấm tiêu đề để đổi tháng/năm, nút "Hôm nay", xóa.
 * Giá trị trao đổi giữ nguyên định dạng của `<input type="date">` cũ để thay thế
 * không phải đổi code gọi: 'YYYY-MM-DD' (hoặc 'YYYY-MM-DDTHH:mm' khi `showTime`),
 * rỗng = chưa chọn. Popup render qua portal (position: fixed) nên không bị
 * Dialog/Drawer có overflow cắt.
 */
export type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  /** 'YYYY-MM-DD' — ngày nhỏ nhất được chọn (bao gồm). */
  min?: string
  /** 'YYYY-MM-DD' — ngày lớn nhất được chọn (bao gồm). */
  max?: string
  /** Chọn thêm giờ:phút (thay cho `datetime-local`). */
  showTime?: boolean
  placeholder?: string
  disabled?: boolean
  /** Hiện nút xóa khi đã có giá trị. Mặc định true. */
  allowClear?: boolean
  /**
   * Lựa chọn nhanh ở chân popup (giống `presets` của Ant DatePicker). `value()` trả ngày 'YYYY-MM-DD'.
   * Preset rơi ngoài `min`/`max` bị ẩn; không còn preset nào thì không hiện hàng này.
   * Mặc định: Tuần trước, Tháng trước, 3 tháng trước. Truyền `[]` để tắt.
   */
  presets?: Array<{ label: string; value: () => string }>
  id?: string
  className?: string
  'aria-label'?: string
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const POPOVER_WIDTH = 288
const POPOVER_HEIGHT_ESTIMATE = 372

const pad = (n: number) => String(n).padStart(2, '0')

function toYMD(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parse 'YYYY-MM-DD' chặt chẽ (từ chối 2001-02-30). */
function parseYMD(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined
}

function parseTime(value: string): { hour: number; minute: number } | undefined {
  const match = /T(\d{2}):(\d{2})/.exec(value)
  if (!match) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour < 24 && minute < 60 ? { hour, minute } : undefined
}

function formatDisplay(value: string, showTime: boolean) {
  const date = parseYMD(value)
  if (!date) return ''
  const text = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
  if (!showTime) return text
  const time = parseTime(value) ?? { hour: 0, minute: 0 }
  return `${text} ${pad(time.hour)}:${pad(time.minute)}`
}

/** Parse chuỗi người dùng gõ: dd/mm/yyyy [HH:mm] → value chuẩn, hoặc undefined nếu sai. */
function parseTyped(text: string, showTime: boolean): string | undefined {
  const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$/.exec(text)
  if (!match) return undefined
  const ymd = `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`
  if (!parseYMD(ymd)) return undefined
  if (!showTime) return ymd
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  if (hour > 23 || minute > 59) return undefined
  return `${ymd}T${pad(hour)}:${pad(minute)}`
}

function buildMonthDays(month: Date) {
  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - firstWeekday)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

/** Lùi `months` tháng, giữ nguyên ngày; kẹp về cuối tháng đích (31/05 − 3 tháng = 28/02, không tràn sang 03/03). */
function minusMonths(from: Date, months: number) {
  const lastDayOfTarget = new Date(from.getFullYear(), from.getMonth() - months + 1, 0).getDate()
  return new Date(from.getFullYear(), from.getMonth() - months, Math.min(from.getDate(), lastDayOfTarget))
}

const DEFAULT_PRESETS: NonNullable<DatePickerProps['presets']> = [
  {
    label: 'Tuần trước',
    value: () => {
      const date = new Date()
      date.setDate(date.getDate() - 7)
      return toYMD(date)
    },
  },
  { label: 'Tháng trước', value: () => toYMD(minusMonths(new Date(), 1)) },
  { label: '3 tháng trước', value: () => toYMD(minusMonths(new Date(), 3)) },
]

type View = 'date' | 'month'

export function DatePicker({
  value,
  onChange,
  min,
  max,
  showTime = false,
  placeholder,
  disabled = false,
  allowClear = true,
  presets = DEFAULT_PRESETS,
  id,
  className = '',
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('date')
  const [viewMonth, setViewMonth] = useState(() => {
    const base = parseYMD(value) ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const [typed, setTyped] = useState<string | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const selectedDate = parseYMD(value)
  const selectedYMD = selectedDate ? toYMD(selectedDate) : ''
  const time = parseTime(value) ?? (() => {
    const now = new Date()
    return { hour: now.getHours(), minute: now.getMinutes() }
  })()
  const todayYMD = toYMD(new Date())
  const display = typed ?? formatDisplay(value, showTime)
  const resolvedPlaceholder = placeholder ?? (showTime ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy')

  const isDisabledDay = (ymd: string) => (min !== undefined && min !== '' && ymd < min) || (max !== undefined && max !== '' && ymd > max)

  const compose = (ymd: string, hour: number, minute: number) =>
    showTime ? `${ymd}T${pad(hour)}:${pad(minute)}` : ymd

  const openPopover = () => {
    if (disabled) return
    const base = parseYMD(value) ?? new Date()
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1))
    setView('date')
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setTyped(null)
  }

  // Định vị popup bằng toạ độ viewport; lật lên trên nếu bên dưới không đủ chỗ.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const height = popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE
      const below = rect.bottom + 6
      const top = below + height > window.innerHeight && rect.top - 6 - height > 0
        ? rect.top - 6 - height
        : below
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
      setPosition({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, view])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      commitTyped()
      close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
    // commitTyped/close đọc state mới nhất qua closure của lần render hiện tại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, typed, value, min, max, showTime])

  const commitTyped = () => {
    if (typed === null) return
    if (typed.trim() === '') {
      if (allowClear) onChange('')
      setTyped(null)
      return
    }
    const parsed = parseTyped(typed, showTime)
    if (parsed && !isDisabledDay(parsed.slice(0, 10))) onChange(parsed)
    setTyped(null) // sai định dạng / ngoài khoảng → quay về giá trị cũ
  }

  const selectDay = (date: Date) => {
    const ymd = toYMD(date)
    if (isDisabledDay(ymd)) return
    setTyped(null)
    onChange(compose(ymd, time.hour, time.minute))
    if (showTime) {
      setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    } else {
      close()
    }
  }

  const selectToday = () => {
    if (isDisabledDay(todayYMD)) return
    const now = new Date()
    setTyped(null)
    onChange(compose(todayYMD, now.getHours(), now.getMinutes()))
    if (!showTime) close()
    else setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  const usablePresets = presets
    .map((preset) => ({ label: preset.label, ymd: preset.value() }))
    .filter((preset) => !isDisabledDay(preset.ymd))

  const selectPreset = (ymd: string) => {
    const base = parseYMD(ymd)
    if (!base) return
    setTyped(null)
    onChange(compose(ymd, time.hour, time.minute))
    if (showTime) setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1))
    else close()
  }

  const changeTime = (hour: number, minute: number) => {
    onChange(compose(selectedYMD || todayYMD, hour, minute))
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitTyped()
      if (!showTime) close()
    } else if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      openPopover()
    }
  }

  const monthAddedBy = (amount: number) =>
    setViewMonth((month) => new Date(month.getFullYear(), month.getMonth() + amount, 1))

  const monthDisabled = (year: number, monthIndex: number) => {
    const first = toYMD(new Date(year, monthIndex, 1))
    const last = toYMD(new Date(year, monthIndex + 1, 0))
    return (min !== undefined && min !== '' && last < min) || (max !== undefined && max !== '' && first > max)
  }

  const hasValue = value !== ''

  return (
    <div ref={rootRef} className={`ds-date-picker ${className}`.trim()}>
      <div
        className={`ds-date-picker__control${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
        onMouseDown={() => { if (!open) openPopover() }}
      >
        <input
          id={id}
          className="ds-date-picker__input"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={display}
          placeholder={resolvedPlaceholder}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onFocus={openPopover}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={commitTyped}
          onKeyDown={onInputKeyDown}
        />
        {allowClear && hasValue && !disabled ? (
          <button
            type="button"
            className="ds-date-picker__clear"
            aria-label="Xóa ngày"
            title="Xóa ngày"
            // mousedown: xóa trước khi blur của input commit lại giá trị đang gõ
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); setTyped(null); onChange('') }}
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
        <CalendarBlank className="ds-date-picker__icon" size={18} weight="bold" aria-hidden="true" />
      </div>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="ds-date-picker__popover"
              role="dialog"
              aria-label={showTime ? 'Chọn ngày giờ' : 'Chọn ngày'}
              style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: POPOVER_WIDTH }}
              // Giữ focus ở ô nhập khi bấm trong popup để không kích hoạt blur-commit.
              onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== 'SELECT') event.preventDefault() }}
            >
              <header className="ds-date-picker__header">
                <button type="button" className="ds-date-picker__nav" aria-label="Năm trước" onClick={() => monthAddedBy(-12)}>
                  <CaretDoubleLeft size={14} weight="bold" aria-hidden="true" />
                </button>
                {view === 'date' ? (
                  <button type="button" className="ds-date-picker__nav" aria-label="Tháng trước" onClick={() => monthAddedBy(-1)}>
                    <CaretLeft size={14} weight="bold" aria-hidden="true" />
                  </button>
                ) : <span />}
                <button
                  type="button"
                  className="ds-date-picker__title"
                  aria-label="Chọn tháng và năm"
                  onClick={() => setView((current) => (current === 'date' ? 'month' : 'date'))}
                >
                  {view === 'date'
                    ? `Tháng ${viewMonth.getMonth() + 1} ${viewMonth.getFullYear()}`
                    : `${viewMonth.getFullYear()}`}
                </button>
                {view === 'date' ? (
                  <button type="button" className="ds-date-picker__nav" aria-label="Tháng sau" onClick={() => monthAddedBy(1)}>
                    <CaretRight size={14} weight="bold" aria-hidden="true" />
                  </button>
                ) : <span />}
                <button type="button" className="ds-date-picker__nav" aria-label="Năm sau" onClick={() => monthAddedBy(12)}>
                  <CaretDoubleRight size={14} weight="bold" aria-hidden="true" />
                </button>
              </header>

              {view === 'date' ? (
                <>
                  <div className="ds-date-picker__weekdays">
                    {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="ds-date-picker__days">
                    {buildMonthDays(viewMonth).map((date) => {
                      const ymd = toYMD(date)
                      const classes = [
                        'ds-date-picker__day',
                        date.getMonth() !== viewMonth.getMonth() ? 'is-outside' : '',
                        ymd === todayYMD ? 'is-today' : '',
                        ymd === selectedYMD ? 'is-selected' : '',
                      ].filter(Boolean).join(' ')
                      return (
                        <button
                          key={ymd}
                          type="button"
                          className={classes}
                          disabled={isDisabledDay(ymd)}
                          aria-label={date.toLocaleDateString('vi-VN')}
                          aria-pressed={ymd === selectedYMD}
                          onClick={() => selectDay(date)}
                        >
                          {date.getDate()}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="ds-date-picker__months">
                  {Array.from({ length: 12 }, (_, monthIndex) => {
                    const isCurrent = selectedDate?.getFullYear() === viewMonth.getFullYear() && selectedDate.getMonth() === monthIndex
                    return (
                      <button
                        key={monthIndex}
                        type="button"
                        className={`ds-date-picker__month${isCurrent ? ' is-selected' : ''}`}
                        disabled={monthDisabled(viewMonth.getFullYear(), monthIndex)}
                        onClick={() => {
                          setViewMonth(new Date(viewMonth.getFullYear(), monthIndex, 1))
                          setView('date')
                        }}
                      >
                        Th{monthIndex + 1}
                      </button>
                    )
                  })}
                </div>
              )}

              {view === 'date' && usablePresets.length > 0 ? (
                <div className="ds-date-picker__presets">
                  {usablePresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="ds-date-picker__preset"
                      onClick={() => selectPreset(preset.ymd)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <footer className="ds-date-picker__footer">
                <button type="button" className="ds-date-picker__today" disabled={isDisabledDay(todayYMD)} onClick={selectToday}>
                  {showTime ? 'Bây giờ' : 'Hôm nay'}
                </button>
                {showTime ? (
                  <>
                    <span className="ds-date-picker__time">
                      <select
                        aria-label="Giờ"
                        value={time.hour}
                        onChange={(event) => changeTime(Number(event.target.value), time.minute)}
                      >
                        {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{pad(hour)}</option>)}
                      </select>
                      :
                      <select
                        aria-label="Phút"
                        value={time.minute}
                        onChange={(event) => changeTime(time.hour, Number(event.target.value))}
                      >
                        {Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{pad(minute)}</option>)}
                      </select>
                    </span>
                    <button type="button" className="ds-date-picker__ok" onClick={close}>OK</button>
                  </>
                ) : null}
              </footer>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
