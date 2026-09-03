import { ArrowRight, CalendarBlank, CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

type DateRangePickerProps = {
  fromDate: string
  toDate: string
  onFromDateChange: (value: string) => void
  onToDateChange: (value: string) => void
  label?: string
  className?: string
}

type RangeBoundary = 'start' | 'end'

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : undefined
}

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function buildMonthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const firstWeekday = (first.getDay() + 6) % 7
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - firstWeekday)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

function formatMonth(month: Date) {
  return `Tháng ${month.getMonth() + 1} ${month.getFullYear()}`
}

function formatValue(value: string, placeholder: string) {
  const date = parseDate(value)
  return date ? date.toLocaleDateString('vi-VN') : placeholder
}

/** A single popup calendar that selects a start and end date as one range. */
export function DateRangePicker({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  label = 'Khoảng thời gian',
  className = '',
}: DateRangePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [boundary, setBoundary] = useState<RangeBoundary>('start')
  const [draftFromDate, setDraftFromDate] = useState<string | undefined>()
  const [draftToDate, setDraftToDate] = useState<string | undefined>()
  const [viewMonth, setViewMonth] = useState(() => {
    const start = parseDate(fromDate) ?? new Date()
    return new Date(start.getFullYear(), start.getMonth(), 1)
  })

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

  const openPicker = (nextBoundary: RangeBoundary) => {
    const selectedValue = nextBoundary === 'start' ? fromDate : toDate
    const selectedDate = parseDate(selectedValue)
    if (selectedDate) setViewMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
    setBoundary(nextBoundary)
    setOpen(true)
  }

  const selectDate = (selectedDate: Date) => {
    const selectedValue = dateValue(selectedDate)
    const selectedFromDate = draftFromDate ?? fromDate

    if (boundary === 'start') {
      setDraftFromDate(selectedValue)
      setDraftToDate('')
      setBoundary('end')
      return
    }

    if (!selectedFromDate) {
      setDraftFromDate(selectedValue)
      setDraftToDate('')
      return
    }

    if (selectedValue >= selectedFromDate) {
      onFromDateChange(selectedFromDate)
      onToDateChange(selectedValue)
    } else {
      onFromDateChange(selectedValue)
      onToDateChange(selectedFromDate)
    }
    setDraftFromDate(undefined)
    setDraftToDate(undefined)
    setOpen(false)
  }

  const clear = () => {
    onFromDateChange('')
    onToDateChange('')
    setDraftFromDate(undefined)
    setDraftToDate(undefined)
    setBoundary('start')
  }

  const visibleFromDate = open && draftFromDate !== undefined ? draftFromDate : fromDate
  const visibleToDate = open && draftToDate !== undefined ? draftToDate : toDate
  const endMonth = addMonths(viewMonth, 1)
  const months = [viewMonth, endMonth]

  return (
    <div ref={rootRef} className={`ds-date-range ${className}`.trim()}>
      <div className="ds-date-range__control" role="group" aria-label={label}>
        <CalendarBlank className="ds-date-range__calendar" size={18} weight="bold" aria-hidden="true" />
        <button
          type="button"
          className={`ds-date-range__value${open && boundary === 'start' ? ' is-active' : ''}`}
          aria-label="Ngày bắt đầu"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => openPicker('start')}
        >
          {formatValue(visibleFromDate, 'Từ ngày')}
        </button>
        <ArrowRight className="ds-date-range__separator" size={16} weight="bold" aria-hidden="true" />
        <button
          type="button"
          className={`ds-date-range__value${open && boundary === 'end' ? ' is-active' : ''}`}
          aria-label="Ngày kết thúc"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => openPicker('end')}
        >
          {formatValue(visibleToDate, 'Đến ngày')}
        </button>
        {visibleFromDate || visibleToDate ? (
          <button type="button" className="ds-date-range__clear" aria-label="Xóa khoảng ngày" title="Xóa khoảng ngày" onClick={clear}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="ds-date-range__popover" role="dialog" aria-label="Chọn khoảng ngày">
          <header className="ds-date-range__header">
            <button type="button" className="ds-date-range__navigate" aria-label="Tháng trước" onClick={() => setViewMonth((month) => addMonths(month, -1))}>
              <CaretLeft size={18} weight="bold" aria-hidden="true" />
            </button>
            <div className="ds-date-range__month-titles">
              {months.map((month) => <strong key={month.toISOString()}>{formatMonth(month)}</strong>)}
            </div>
            <button type="button" className="ds-date-range__navigate" aria-label="Tháng sau" onClick={() => setViewMonth((month) => addMonths(month, 1))}>
              <CaretRight size={18} weight="bold" aria-hidden="true" />
            </button>
          </header>

          <div className="ds-date-range__months">
            {months.map((month) => (
              <section key={month.toISOString()} className="ds-date-range__month" aria-label={formatMonth(month)}>
                <div className="ds-date-range__weekdays">
                  {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="ds-date-range__days">
                  {buildMonthDays(month).map((date) => {
                    const value = dateValue(date)
                    const isStart = value === visibleFromDate
                    const isEnd = value === visibleToDate
                    const isInRange = Boolean(visibleFromDate && visibleToDate && value > visibleFromDate && value < visibleToDate)
                    const isOutsideMonth = date.getMonth() !== month.getMonth()
                    const classes = [
                      'ds-date-range__day',
                      isOutsideMonth ? 'is-outside' : '',
                      isInRange ? 'is-in-range' : '',
                      isStart ? 'is-range-start' : '',
                      isEnd ? 'is-range-end' : '',
                    ].filter(Boolean).join(' ')

                    return (
                      <button
                        key={value}
                        type="button"
                        className={classes}
                        aria-label={date.toLocaleDateString('vi-VN')}
                        aria-pressed={isStart || isEnd}
                        onClick={() => selectDate(date)}
                      >
                        {date.getDate()}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
