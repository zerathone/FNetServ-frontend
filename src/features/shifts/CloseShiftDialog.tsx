// task work-shift S2 — chốt ca khi Đăng xuất (design R4). Hai màn: (1) Chốt ca: tóm tắt, tiền dự kiến, tiền thực đếm,
// cảnh báo đơn chờ; (2) Kết quả: số server trả, in phiếu, rồi mới Đăng xuất. Chốt lỗi ⇒ KHÔNG đăng xuất.
// Server là chốt chặn (SHIFT_PENDING_ORDERS); client chỉ đọc trước để cảnh báo, không tự chặn.
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle, LockKey, Printer, SignOut, Warning } from '@phosphor-icons/react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBookingList } from '../../api/onlineBooking'
import { ApiError } from '../../api/client'
import { getPendingComboOrders, getPendingOrders } from '../../api/orders'
import {
  closeShift,
  type ShiftCloseResult,
  type ShiftInfo,
  type ShiftPendingCounts,
} from '../../api/shift'
import { Button, Dialog, InlineAlert, MoneyInput, StateView } from '../../design-system/components'
import { createIdempotencyKey } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { useLicenseInfo } from '../license/useLicenseInfo'
import { OB_RIGHTS } from '../online-booking/onlineBookingModel'
import { describePrintFailure, printerPaper } from '../orders/printTicketModel'
import { PosPrinterPicker } from '../printers/PosPrinterPicker'
import { printHtmlToPos, printHtmlViaBrowser, usePosPrintPrefs, usePosPrinters } from '../printers/posPrint'
import { pickPrinterId } from '../printers/posPrintModel'
import { ShiftSummaryTable } from './ShiftSummaryTable'
import {
  MAX_SHIFT_NOTE,
  buildCloseTicketHtml,
  cashDifference,
  countPendingMainLines,
  formatMoney,
  formatShiftDateTime,
  formatSigned,
  hasPending,
  normalizePendingCounts,
  sanitizeNoteInput,
  validateCashInput,
  validateShiftNote,
} from './shiftModel'
import { useShift, useShiftSummary } from './useShift'
import './shifts.css'

type Props = {
  shift: ShiftInfo
  /** Huỷ — quay lại làm việc, KHÔNG đăng xuất. */
  onCancel: () => void
  /** Đăng xuất — chỉ gọi từ màn kết quả, SAU khi đã chốt xong (Đăng xuất = chốt ca, design R4). */
  onLogout: () => void
  logoutPending: boolean
}

export function CloseShiftDialog({ shift, onCancel, onLogout, logoutPending }: Props) {
  const [result, setResult] = useState<ShiftCloseResult | null>(null)
  if (result) return <CloseResultDialog result={result} onLogout={onLogout} logoutPending={logoutPending} />
  return (
    <CloseFormDialog shift={shift} onCancel={onCancel} onClosed={setResult} />
  )
}

// ---------------------------------------------------------------------------------------------
// Màn 1 — chốt ca
// ---------------------------------------------------------------------------------------------

/** Đọc trước số đơn chờ (không chặn; server mới là chốt chặn). Booking: lỗi / thiếu quyền ⇒ ẩn im lặng (OB3). */
function useCloseWarnings() {
  const hasRight = useAuthStore((state) => state.hasRight)
  const canSeeBookings = hasRight(OB_RIGHTS.APPROVE) || hasRight(OB_RIGHTS.CANCEL)
  const options = { retry: false, staleTime: 0, refetchOnWindowFocus: false } as const
  const service = useQuery({
    ...options,
    queryKey: ['shift', 'close-warn', 'service'],
    // Đúng tập mà Hàng đợi hiển thị: includePaid=1 (có QR đã trả), bỏ dòng topping.
    queryFn: async () => countPendingMainLines(await getPendingOrders(undefined, { includePaid: true })),
  })
  const combo = useQuery({
    ...options,
    queryKey: ['shift', 'close-warn', 'combo'],
    queryFn: async () => (await getPendingComboOrders(0)).length, // 0 = không lọc 24 giờ
  })
  const booking = useQuery({
    ...options,
    queryKey: ['shift', 'close-warn', 'booking'],
    enabled: canSeeBookings, // không đủ quyền thì không gọi, tránh toast RBAC_DENIED
    queryFn: async () => (await getBookingList({ status: 'wait_approval', limit: 1 })).total,
  })
  return {
    service,
    combo,
    booking,
    refetch: () => {
      void service.refetch()
      void combo.refetch()
      if (canSeeBookings) void booking.refetch()
    },
  }
}

type FormProps = Pick<Props, 'shift' | 'onCancel'> & { onClosed: (result: ShiftCloseResult) => void }

function CloseFormDialog({ shift, onCancel, onClosed }: FormProps) {
  const navigate = useNavigate()
  const { applyClosed } = useShift()
  const summaryQuery = useShiftSummary(shift.shiftId)
  const warn = useCloseWarnings()
  // `idem` sinh MỘT lần khi dialog mở, dùng lại cho mọi lần bấm / thử lại.
  const [idem, setIdem] = useState(() => createIdempotencyKey('shift-close'))
  const [counted, setCounted] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [lock, setLock] = useState<ShiftPendingCounts | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const expected = summaryQuery.data?.expectedCash ?? null
  const countedError = validateCashInput(counted, 'Tiền thực đếm')
  const noteError = validateShiftNote(note)
  const preview = expected === null ? null : cashDifference(counted, expected)

  const mutation = useMutation({
    mutationFn: () =>
      closeShift({
        idem,
        shiftId: shift.shiftId,
        countedCash: counted ?? undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: (data) => {
      applyClosed()
      onClosed(data)
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.code === 'idem_mismatch') {
        // Lần gọi trước có thể đã chốt (mất phản hồi) rồi mới sửa nội dung: dùng mã mới, guard Status=1 ở server
        // sẽ trả lại ca đã chốt (alreadyClosed) thay vì chốt hai lần.
        setIdem(createIdempotencyKey('shift-close'))
        setFailure('Lần chốt trước chưa rõ kết quả. Bấm Chốt ca lại để kiểm tra.')
      } else if (error instanceof ApiError && error.code === 'SHIFT_PENDING_ORDERS') {
        // Server đặt số lượng trong data (cùng cấp `code`) — đọc từ details.
        setLock(normalizePendingCounts(error.details) ?? { pendingService: 0, pendingCombo: 0, qrPaidUnconfirmed: 0, qrPaidAmount: 0 })
        setFailure(null)
      } else {
        setFailure(error.message || 'Không chốt được ca. Ca vẫn đang mở.')
      }
    },
  })

  const busy = mutation.isPending
  const submit = () => {
    if (busy || lock || countedError || noteError) return
    setFailure(null)
    mutation.mutate()
  }

  const goTo = (path: string) => {
    onCancel()
    navigate(path)
  }

  const serviceCount = warn.service.data?.mains ?? 0
  const serviceQr = warn.service.data?.qrPaid ?? 0
  const comboCount = warn.combo.data ?? 0
  const bookingCount = warn.booking.data ?? 0
  const pendingKnown = warn.service.isSuccess || warn.combo.isSuccess
  const pendingTotal = serviceCount + comboCount

  return (
    <Dialog
      open
      size="lg"
      title="Chốt ca và đăng xuất"
      description={`Ca #${shift.shiftId} · ${shift.staffName || 'Nhân viên'} · bắt đầu ${formatShiftDateTime(shift.openTime)}`}
      onClose={() => {
        if (!busy) onCancel()
      }}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Hủy
          </Button>
          <Button
            type="submit"
            form="shift-close-form"
            variant="primary"
            icon={<LockKey size={18} weight="bold" aria-hidden="true" />}
            loading={busy}
            disabled={Boolean(lock) || Boolean(countedError) || Boolean(noteError)}
          >
            Chốt ca & đăng xuất
          </Button>
        </>
      }
    >
      <form
        id="shift-close-form"
        className="shift-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {lock ? (
          <InlineAlert tone="danger">
            <strong>Chưa chốt được ca — còn đơn đang chờ duyệt</strong>
            <ul className="shift-list">
              <li>{lock.pendingService} món chờ duyệt</li>
              <li>{lock.pendingCombo} combo chờ xác nhận</li>
              <li>
                {lock.qrPaidUnconfirmed} đơn QR đã thanh toán chưa xác nhận
                {lock.qrPaidAmount > 0 ? ` (${formatMoney(lock.qrPaidAmount)})` : ''}
              </li>
            </ul>
            <p className="shift-form__hint">
              Hãy duyệt / huỷ hết đơn đang chờ trước khi chốt ca. Nếu đơn bị kẹt, nhờ quản lý đóng ca.
            </p>
            <div className="shift-actions">
              <Button type="button" variant="secondary" onClick={() => goTo('/orders')}>
                Mở Hàng đợi đơn
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLock(null)
                  warn.refetch()
                }}
              >
                Kiểm tra lại
              </Button>
            </div>
          </InlineAlert>
        ) : null}

        <dl className="shift-stats">
          <div>
            <dt>Tiền mặt đầu ca</dt>
            <dd>{formatMoney(shift.openingCash)}</dd>
          </div>
          <div className="shift-stats__key">
            <dt>Tiền mặt dự kiến</dt>
            <dd>{expected === null ? '…' : formatMoney(expected)}</dd>
          </div>
          <div>
            <dt>Doanh thu ca</dt>
            <dd>{summaryQuery.data ? formatMoney(summaryQuery.data.totals.total) : '…'}</dd>
          </div>
        </dl>

        {summaryQuery.isLoading ? (
          <StateView title="Đang tính doanh thu ca" />
        ) : summaryQuery.isError || !summaryQuery.data ? (
          <InlineAlert tone="warning">
            Không tải được tóm tắt ca ({(summaryQuery.error as Error | null)?.message ?? 'lỗi không rõ'}). Vẫn có thể chốt —
            số chốt do máy chủ tính lại.{' '}
            <Button type="button" variant="ghost" onClick={() => void summaryQuery.refetch()}>
              Thử lại
            </Button>
          </InlineAlert>
        ) : (
          <details className="shift-details">
            <summary>Xem doanh thu theo nguồn ({summaryQuery.data.sources.length} nguồn)</summary>
            <ShiftSummaryTable summary={summaryQuery.data} compact />
          </details>
        )}

        <MoneyInput
          label="Tiền thực đếm (tuỳ chọn)"
          value={counted}
          onChange={setCounted}
          error={countedError}
          hint="Đếm tiền trong két rồi nhập. Để trống nếu chưa đếm."
          disabled={busy}
        />
        {preview !== null ? (
          <p className="shift-diff" role="status">
            <span>Chênh lệch tạm tính</span>
            <strong className={preview === 0 ? 'is-ok' : preview < 0 ? 'is-short' : 'is-over'}>
              {preview === 0 ? 'Khớp' : preview < 0 ? 'Thiếu' : 'Thừa'} {formatSigned(preview)}
            </strong>
            <small>= thực đếm − dự kiến; số chốt do máy chủ tính.</small>
          </p>
        ) : null}

        <label className="ds-field">
          <span className="ds-field__label">Ghi chú (tuỳ chọn)</span>
          <textarea
            className="ds-input"
            rows={2}
            maxLength={MAX_SHIFT_NOTE}
            value={note}
            disabled={busy}
            aria-invalid={Boolean(noteError)}
            // Enter không chèn xuống dòng: server từ chối ký tự điều khiển trong ghi chú.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
            onChange={(event) => setNote(sanitizeNoteInput(event.target.value))}
          />
          {noteError ? (
            <span className="ds-field__error">{noteError}</span>
          ) : (
            <span className="ds-field__hint">{note.length}/{MAX_SHIFT_NOTE}</span>
          )}
        </label>

        {!lock && (pendingTotal > 0 || bookingCount > 0) ? (
          <InlineAlert tone="warning">
            <strong>Còn việc đang chờ</strong>
            <ul className="shift-list">
              {serviceCount > 0 ? (
                <li>
                  {serviceCount} món chờ duyệt{serviceQr > 0 ? ` (${serviceQr} đã trả QR, chưa xác nhận)` : ''}
                </li>
              ) : null}
              {comboCount > 0 ? <li>{comboCount} combo chờ xác nhận</li> : null}
              {bookingCount > 0 ? <li>{bookingCount} đơn đặt máy chờ duyệt (chỉ nhắc, không chặn chốt ca)</li> : null}
            </ul>
            <div className="shift-actions">
              {serviceCount > 0 ? (
                <Button type="button" variant="secondary" onClick={() => goTo('/orders')}>
                  Mở Hàng đợi đơn
                </Button>
              ) : null}
              {comboCount > 0 ? (
                <Button type="button" variant="secondary" onClick={() => goTo('/combo_sale')}>
                  Mở Bán COMBO
                </Button>
              ) : null}
              {bookingCount > 0 ? (
                <Button type="button" variant="secondary" onClick={() => goTo('/online-booking')}>
                  Mở Đặt máy online
                </Button>
              ) : null}
            </div>
            <p className="shift-form__hint">
              Máy chủ sẽ từ chối chốt nếu đây là ca duy nhất còn mở mà vẫn còn món / combo chờ duyệt.
            </p>
          </InlineAlert>
        ) : null}
        {!lock && !pendingKnown && (warn.service.isError || warn.combo.isError) ? (
          <p className="shift-form__hint">
            Chưa đọc được số đơn đang chờ — máy chủ vẫn kiểm tra lại lúc chốt.
          </p>
        ) : null}

        {failure ? (
          <InlineAlert tone="danger">
            {failure} Ca vẫn đang mở, bạn chưa bị đăng xuất.
          </InlineAlert>
        ) : null}
      </form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Màn 2 — kết quả (số server trả) + in phiếu + Đăng xuất
// ---------------------------------------------------------------------------------------------

function CloseResultDialog({
  result,
  onLogout,
  logoutPending,
}: {
  result: ShiftCloseResult
  onLogout: () => void
  logoutPending: boolean
}) {
  const { shift, summary, warnings } = result
  const licenseQuery = useLicenseInfo()
  const shopName = licenseQuery.data?.shopName || ''
  const { printers, isLoading, isError, error } = usePosPrinters()
  const [prefs, updatePrefs] = usePosPrintPrefs('shift')
  const printerId = pickPrinterId(printers, prefs.printerId, undefined)
  const [printing, setPrinting] = useState(false)
  const [printFailure, setPrintFailure] = useState<string | null>(null)

  const diff = shift.cashDiff
  const printer = printers.find((item) => item.printerId === printerId)
  const paper = printer ? printerPaper(printer.type) : null

  const printPos = async () => {
    if (!printer || !paper) return
    setPrinting(true)
    setPrintFailure(null)
    try {
      await printHtmlToPos({
        printerId,
        type: paper.type,
        html: buildCloseTicketHtml({ shopName, result, type: paper.type }),
      })
      pushToast('Đã gửi phiếu chốt ca tới máy in.', 'success')
    } catch (failureReason) {
      // In lỗi không ảnh hưởng ca đã chốt; cho in lại hoặc in bằng trình duyệt.
      setPrintFailure(describePrintFailure(failureReason).message)
    } finally {
      setPrinting(false)
    }
  }

  const printBrowser = () => {
    try {
      printHtmlViaBrowser(
        `<div style="max-width:80mm">${buildCloseTicketHtml({ shopName, result, type: 1 })}</div>`,
        `Phiếu chốt ca #${shift.shiftId}`,
      )
    } catch (failureReason) {
      setPrintFailure((failureReason as Error).message)
    }
  }

  return (
    <Dialog
      open
      size="md"
      hideClose
      title={`Đã chốt ca #${shift.shiftId}`}
      description={shift.closeTime ? `Chốt lúc ${formatShiftDateTime(shift.closeTime)}` : undefined}
      // Ca đã chốt: lối ra là nút Đăng xuất (Esc/nền không làm gì để không kẹt ở màn hình không có ca).
      onClose={() => {}}
      footer={
        <>
          {printers.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              loading={printing}
              icon={<Printer size={18} weight="bold" aria-hidden="true" />}
              onClick={() => void printPos()}
            >
              In phiếu chốt ca
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              icon={<Printer size={18} weight="bold" aria-hidden="true" />}
              onClick={printBrowser}
            >
              In phiếu chốt ca (trình duyệt)
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            loading={logoutPending}
            icon={<SignOut size={18} weight="bold" aria-hidden="true" />}
            onClick={onLogout}
          >
            Đăng xuất
          </Button>
        </>
      }
    >
      <div className="shift-form">
        <InlineAlert tone={result.alreadyClosed ? 'info' : 'success'}>
          <span className="shift-inline-icon">
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
            {result.alreadyClosed ? 'Ca này đã được chốt trước đó.' : 'Ca đã chốt thành công.'}
          </span>
        </InlineAlert>

        {warnings && hasPending(warnings) ? (
          <InlineAlert tone="warning">
            <span className="shift-inline-icon">
              <Warning size={18} weight="fill" aria-hidden="true" />
              Còn ca khác đang mở — {warnings.pendingService} món, {warnings.pendingCombo} combo và{' '}
              {warnings.qrPaidUnconfirmed} đơn QR đã trả chưa xác nhận sẽ do ca còn lại xử lý.
            </span>
          </InlineAlert>
        ) : null}

        <dl className="shift-stats shift-stats--result">
          <div>
            <dt>Doanh thu ca</dt>
            <dd>{summary ? formatMoney(summary.totals.total) : '—'}</dd>
          </div>
          <div>
            <dt>Tiền mặt dự kiến</dt>
            <dd>{shift.expectedCash === null ? '—' : formatMoney(shift.expectedCash)}</dd>
          </div>
          <div>
            <dt>Tiền thực đếm</dt>
            <dd>{shift.countedCash === null ? 'Không nhập' : formatMoney(shift.countedCash)}</dd>
          </div>
          <div className="shift-stats__key">
            <dt>Chênh lệch</dt>
            <dd className={diff === null ? '' : diff === 0 ? 'is-ok' : diff < 0 ? 'is-short' : 'is-over'}>
              {diff === null ? '—' : `${diff === 0 ? 'Khớp' : diff < 0 ? 'Thiếu' : 'Thừa'} ${formatSigned(diff)}`}
            </dd>
          </div>
        </dl>

        {shift.note ? <p className="shift-form__hint">Ghi chú: {shift.note}</p> : null}

        <PosPrinterPicker
          idPrefix="shift-close"
          printers={printers}
          printerId={printerId}
          onPrinterChange={(value) => updatePrefs({ printerId: value })}
          loading={isLoading}
          errorMessage={isError ? (error as Error).message : undefined}
          disabled={printing}
        />
        {printFailure ? (
          <InlineAlert tone="danger">
            {printFailure} Ca đã chốt, việc in lỗi không ảnh hưởng.{' '}
            <Button type="button" variant="ghost" onClick={printBrowser}>
              In bằng trình duyệt
            </Button>
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  )
}
