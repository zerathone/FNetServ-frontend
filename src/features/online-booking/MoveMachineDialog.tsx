import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Desktop, XCircle } from '@phosphor-icons/react'
import {
  epochSeconds,
  getBoard,
  moveBooking,
  type BoardMachine,
  type Booking,
} from '../../api/onlineBooking'
import { Button, Dialog, InlineAlert, StateView, StatusBadge } from '../../design-system/components'
import { foldText } from '../orders/staffOrderModel'
import {
  describeBookingError,
  formatBookingRange,
  formatMoney,
  PC_STATE_LABEL,
  PC_STATE_TONE,
} from './onlineBookingModel'

/** Bảng có thể 200-400 máy — chỉ dựng ngần này nút mỗi nhóm, gõ thêm để thu hẹp. */
const MACHINE_RESULT_LIMIT = 12

type MoveMachineDialogProps = {
  open: boolean
  booking: Booking | null
  onClose: () => void
  onMoved: () => void
}

/**
 * OB-R9 — đổi máy cho đơn đã xác nhận, khách chưa vào máy.
 *
 * Danh sách máy lấy từ `/onlinebook/board` với ĐÚNG khung giờ của đơn (`from` + `minutes`), nên cờ
 * `available` đã gồm sẵn mọi luật của server: máy có cho đặt online không, có trùng khung không, và
 * có phải đang tắt không (ngưỡng `require_off_within`). Frontend KHÔNG tự chấm lại luật nào.
 *
 * Chia 2 nhóm là luật HIỂN THỊ, không phải luật server: mặc định chỉ hiện máy giá bằng hoặc cao hơn
 * máy hiện tại; muốn hạ cấp máy thì phải tick thêm một ô. Dù chọn nhóm nào, TIỀN CỦA ĐƠN KHÔNG ĐỔI.
 */
export function MoveMachineDialog({ open, booking, onClose, onMoved }: MoveMachineDialogProps) {
  const [pcSearch, setPcSearch] = useState('')
  const [pc, setPc] = useState('')
  const [showCheaper, setShowCheaper] = useState(false)

  useEffect(() => {
    if (!open) return
    setPcSearch('')
    setPc('')
    setShowCheaper(false)
  }, [open, booking?.bookId])

  const boardQuery = useQuery({
    queryKey: ['onlinebook-board-move', booking?.bookId, booking?.from, booking?.minutes],
    queryFn: () =>
      getBoard({ from: epochSeconds(new Date(booking!.from)), minutes: booking!.minutes }),
    enabled: open && Boolean(booking),
  })

  // Nhóm giá của hội viên trên đơn. Server trước OB-R9 không trả `userGroupId` ⇒ suy ngược từ cột giá
  // khớp đúng giá/giờ của đơn trên chính máy hiện tại.
  const userGroupId = useMemo(() => {
    if (!booking) return undefined
    if (typeof booking.userGroupId === 'number' && booking.userGroupId > 0) return booking.userGroupId
    const current = boardQuery.data?.machines.find((m) => m.pc === booking.pc)
    return current?.prices.find((p) => p.pricePerHour === booking.pricePerHour)?.userGroupId
  }, [booking, boardQuery.data])

  const priceOf = (m: BoardMachine): number | null =>
    m.prices.find((p) => p.userGroupId === userGroupId)?.pricePerHour ?? null

  const candidates = useMemo(() => {
    if (!booking) return []
    const needle = foldText(pcSearch)
    return (boardQuery.data?.machines ?? [])
      .filter((m) => m.available && m.pc !== booking.pc)
      .filter((m) => !needle || foldText(`${m.pc} ${m.machineGroup}`).includes(needle))
      .sort((a, b) => a.pc.localeCompare(b.pc, 'vi', { numeric: true }))
  }, [boardQuery.data, booking, pcSearch])

  // Giá chưa đọc được (nhóm máy không có bảng giá cho nhóm hội viên này) xếp cùng nhóm "thấp hơn":
  // không rõ thì đừng bày ra mặc định.
  const sameOrHigher = candidates.filter((m) => {
    const p = priceOf(m)
    return p !== null && booking !== null && p >= booking.pricePerHour
  })
  const cheaper = candidates.filter((m) => !sameOrHigher.includes(m))

  const moveMutation = useMutation({
    mutationFn: () => moveBooking({ bookId: booking!.bookId, pc }),
    onSuccess: () => {
      onMoved()
      onClose()
    },
  })

  if (!booking) return null

  const range = formatBookingRange(booking.from, booking.to)
  const selected = candidates.find((m) => m.pc === pc)

  const renderGroup = (list: BoardMachine[], emptyText: string) => {
    if (list.length === 0) return <span className="ds-field__hint">{emptyText}</span>
    return (
      <div className="ob-pc-results" role="listbox" aria-label="Máy có thể đổi sang">
        {list.slice(0, MACHINE_RESULT_LIMIT).map((m) => {
          const price = priceOf(m)
          return (
            <button
              key={m.pc}
              type="button"
              role="option"
              aria-selected={m.pc === pc}
              className={`ob-pc-chip${m.pc === pc ? ' is-active' : ''}`}
              title={`${m.pc} · ${m.machineGroup} · ${price === null ? 'chưa có giá cho nhóm hội viên này' : `${formatMoney(price)}/giờ`}`}
              onClick={() => {
                setPc(m.pc)
                moveMutation.reset()
              }}
            >
              <strong>{m.pc}</strong>
              <span className="ob-pc-chip__meta">{m.machineGroup}</span>
              <span className="ob-pc-chip__meta">
                {price === null ? 'chưa có giá' : `${formatMoney(price)}/giờ`}
              </span>
              <span className="ob-pc-chip__meta">{PC_STATE_LABEL[m.pcState]}</span>
            </button>
          )
        })}
        {list.length > MACHINE_RESULT_LIMIT ? (
          <span className="ds-field__hint">
            Còn {list.length - MACHINE_RESULT_LIMIT} máy nữa — gõ tên máy để thu hẹp.
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      title="Đổi máy cho đơn"
      description="Chỉ đổi được khi khách chưa vào máy. Số tiền của đơn giữ nguyên, kể cả khi đổi sang máy khác giá."
      size="md"
      onClose={moveMutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={moveMutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!selected}
            loading={moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
          >
            {selected ? `Đổi sang ${selected.pc}` : 'Chọn máy'}
          </Button>
        </>
      }
    >
      <div className="ob-move">
        <InlineAlert tone="info">
          Đơn <strong>{booking.bookCode}</strong> · máy hiện tại <strong>{booking.pc}</strong> (
          {booking.machineGroup}) · {range ? `${range.fromTime} → ${range.toTime}` : ''} ·{' '}
          {formatMoney(booking.pricePerHour)}/giờ · tổng <strong>{formatMoney(booking.total)}</strong>
        </InlineAlert>

        {booking.movedFrom ? (
          <InlineAlert tone="warning">
            Đơn này đã từng đổi máy, trước đó ở <strong>{booking.movedFrom.pc}</strong>.
          </InlineAlert>
        ) : null}

        <div className="ds-field">
          <div className="ds-input-group ds-input-group--search">
            <label className="ob-staff-form__prefix" htmlFor="ob-move-pc" title="Tìm máy">
              <Desktop size={18} weight="bold" aria-hidden="true" />
              <span className="ds-visually-hidden">Tìm máy</span>
            </label>
            <div className="ds-search-input">
              <input
                id="ob-move-pc"
                className="ds-input"
                placeholder="Gõ tên máy hoặc nhóm máy để lọc"
                value={pcSearch}
                autoComplete="off"
                onChange={(event) => setPcSearch(event.target.value)}
              />
              {pcSearch ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa từ khóa"
                  onClick={() => setPcSearch('')}
                >
                  <XCircle size={17} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <span className="ds-field__hint">
            Chỉ hiện máy còn trống đúng khung giờ của đơn và đáp ứng điều kiện trạng thái máy — do máy chủ
            tính, không phải màn hình này lọc.
          </span>
        </div>

        {boardQuery.isLoading ? (
          <StateView title="Đang tải danh sách máy…" />
        ) : boardQuery.isError ? (
          <InlineAlert tone="danger">{describeBookingError(boardQuery.error)}</InlineAlert>
        ) : (
          <>
            <div className="ob-move__group">
              <span className="ds-field__label">Máy cùng giá hoặc cao hơn</span>
              {renderGroup(sameOrHigher, 'Không có máy nào cùng giá hoặc cao hơn còn trống khung giờ này.')}
            </div>

            <label className="ob-move__toggle">
              <input
                type="checkbox"
                checked={showCheaper}
                onChange={(event) => {
                  setShowCheaper(event.target.checked)
                  if (!event.target.checked && selected && !sameOrHigher.includes(selected)) setPc('')
                }}
              />
              <span>Hiện cả máy giá thấp hơn ({cheaper.length})</span>
            </label>

            {showCheaper ? (
              <div className="ob-move__group">
                <InlineAlert tone="warning">
                  Đổi xuống máy giá thấp hơn: tiền của đơn vẫn giữ nguyên, hội viên không được hoàn chênh lệch.
                </InlineAlert>
                {renderGroup(cheaper, 'Không có máy giá thấp hơn còn trống khung giờ này.')}
              </div>
            ) : null}
          </>
        )}

        {selected ? (
          <InlineAlert tone="info">
            Đổi <strong>{booking.pc}</strong> → <strong>{selected.pc}</strong> ({selected.machineGroup}
            {priceOf(selected) !== null ? ` · ${formatMoney(priceOf(selected)!)}/giờ` : ''}).{' '}
            <StatusBadge tone={PC_STATE_TONE[selected.pcState]}>{PC_STATE_LABEL[selected.pcState]}</StatusBadge>{' '}
            Tổng tiền giữ nguyên <strong>{formatMoney(booking.total)}</strong>.
          </InlineAlert>
        ) : null}

        {moveMutation.isError ? (
          <InlineAlert tone="danger">{describeBookingError(moveMutation.error)}</InlineAlert>
        ) : null}
      </div>
    </Dialog>
  )
}
