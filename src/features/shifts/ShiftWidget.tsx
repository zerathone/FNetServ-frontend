// task work-shift S2 — widget ca ở sidebar (chỉ vai trò Thu ngân, đặt dưới "Nguồn thu ca").
// `enabled = false` (INT_SHIFT_MODE = 0): không render gì, không gọi thêm request nào ngoài /shift/current.
import { Clock, Info, LockKeyOpen } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button, IconButton, StatusBadge } from '../../design-system/components'
import { PauseIntakeButton } from './PauseIntakeButton'
import { ShiftInfoDrawer } from './ShiftInfoDrawer'
import { formatMoney, formatShiftTime, isIntakePaused } from './shiftModel'
import { useShift, useShiftSummary, useShiftUiStore } from './useShift'
import './shifts.css'

/**
 * Lối vào gọn ở thanh trên cùng. Giao diện "Cổ điển" (classic) ẩn cả phần đầu sidebar (`.app-sidebar__header`) nên
 * widget sidebar không thấy được; chip này (chỉ CSS-hiện ở classic ≥ 901px) giữ lối vào "Thông tin ca" / "Mở ca".
 */
export function ShiftTopbarChip() {
  const { enabled, shift } = useShift()
  const summaryQuery = useShiftSummary(shift?.shiftId ?? null)
  const requestOpen = useShiftUiStore((state) => state.requestOpen)
  const [infoOpen, setInfoOpen] = useState(false)

  if (!enabled) return null

  if (!shift) {
    return (
      <Button
        type="button"
        variant="secondary"
        className="shift-chip"
        icon={<LockKeyOpen size={18} weight="bold" aria-hidden="true" />}
        onClick={requestOpen}
      >
        Mở ca
      </Button>
    )
  }

  const total = summaryQuery.data?.totals.total
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="shift-chip"
        icon={<Clock size={18} weight="bold" aria-hidden="true" />}
        title="Thông tin ca"
        aria-label={`Thông tin ca #${shift.shiftId}`}
        onClick={() => setInfoOpen(true)}
      >
        Ca #{shift.shiftId}
        {total === undefined ? '' : ` · ${formatMoney(total)}`}
      </Button>
      <ShiftInfoDrawer open={infoOpen} shift={shift} onClose={() => setInfoOpen(false)} />
    </>
  )
}

export function ShiftWidget() {
  const { enabled, shift, orderPause } = useShift()
  const summaryQuery = useShiftSummary(shift?.shiftId ?? null)
  const requestOpen = useShiftUiStore((state) => state.requestOpen)
  const [infoOpen, setInfoOpen] = useState(false)

  if (!enabled) return null

  if (!shift) {
    return (
      <section className="shift-widget" aria-label="Ca làm việc">
        <div className="shift-widget__full">
          <div className="shift-widget__head">
            <span className="shift-widget__title">Ca làm việc</span>
            <StatusBadge tone="warning">Chưa mở ca</StatusBadge>
          </div>
          <Button
            type="button"
            variant="primary"
            block
            icon={<LockKeyOpen size={18} weight="bold" aria-hidden="true" />}
            onClick={requestOpen}
          >
            Mở ca
          </Button>
        </div>
        <IconButton
          className="shift-widget__mini"
          label="Mở ca"
          icon={<LockKeyOpen size={22} weight="bold" aria-hidden="true" />}
          onClick={requestOpen}
        />
      </section>
    )
  }

  const total = summaryQuery.data?.totals.total

  return (
    <section className="shift-widget" aria-label="Ca làm việc">
      <div className="shift-widget__full">
        <div className="shift-widget__head">
          <span className="shift-widget__title">Ca làm việc</span>
          <StatusBadge tone="success">Đang mở</StatusBadge>
        </div>
        <p className="shift-widget__since">
          Ca #{shift.shiftId} · từ {formatShiftTime(shift.openTime)}
        </p>
        {isIntakePaused(orderPause) ? <StatusBadge tone="danger">Đang ngừng nhận đơn</StatusBadge> : null}
        <div className="shift-widget__total" aria-live="polite">
          <span>Doanh thu ca</span>
          {summaryQuery.isError && total === undefined ? (
            <button type="button" className="shift-widget__retry" onClick={() => void summaryQuery.refetch()}>
              Không tải được — thử lại
            </button>
          ) : (
            <strong>{total === undefined ? '…' : formatMoney(total)}</strong>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          block
          icon={<Info size={18} weight="bold" aria-hidden="true" />}
          onClick={() => setInfoOpen(true)}
        >
          Thông tin ca
        </Button>
        <PauseIntakeButton block />
      </div>
      <IconButton
        className="shift-widget__mini"
        label={`Thông tin ca #${shift.shiftId}`}
        icon={<Clock size={22} weight="bold" aria-hidden="true" />}
        onClick={() => setInfoOpen(true)}
      />
      <ShiftInfoDrawer open={infoOpen} shift={shift} onClose={() => setInfoOpen(false)} />
    </section>
  )
}
