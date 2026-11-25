// task work-shift S2 — Dialog "Mở ca". Hiện khi INT_SHIFT_MODE ≥ 1, nhân viên chưa có ca, đang ở vai trò Thu ngân.
// Thu ngân thường: KHÔNG đóng bằng Esc/X/nền — lối ra ngoài "Mở ca" là Đăng xuất. Admin/Quản lý có thêm "Chỉ xem" (Q5).
import { useMutation } from '@tanstack/react-query'
import { LockKeyOpen, SignOut } from '@phosphor-icons/react'
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { openShift, resumeOrderIntake, type ShiftLastClosed } from '../../api/shift'
import { Button, Dialog, InlineAlert, MoneyInput } from '../../design-system/components'
import { createIdempotencyKey } from '../../lib/idempotency'
import { pushToast } from '../../store/toast'
import {
  formatMoney,
  formatShiftDateTime,
  isManualPaused,
  pauseResumeQuestion,
  validateCashInput,
} from './shiftModel'
import { useShift, useShiftUiStore } from './useShift'
import './shifts.css'

type Props = {
  staffName: string
  serverTime: string
  lastClosed: ShiftLastClosed | null
  /** Admin / vai trò Quản lý được "Chỉ xem" (không mở ca). */
  canViewOnly: boolean
  onViewOnly: () => void
  onLogout: () => void
  logoutPending: boolean
}

export function OpenShiftDialog({
  staffName,
  serverTime,
  lastClosed,
  canViewOnly,
  onViewOnly,
  onLogout,
  logoutPending,
}: Props) {
  const { applyOpened, orderPause } = useShift()
  // Q8: dừng nhận đơn sống qua chốt ca — người mở ca sau được HỎI, mặc định KHÔNG tự bật lại.
  // Hỏi theo cờ THỦ CÔNG (`manual.on`), không theo `on`: người ca trước ngừng rồi chốt ca cuối thì `noShift` cũng true.
  const askResume = isManualPaused(orderPause)
  const [resumeIntake, setResumeIntake] = useState(false)
  // `idem` sinh MỘT lần khi dialog mở, dùng lại cho mọi lần bấm / thử lại (server chống mở trùng).
  const [idem, setIdem] = useState(() => createIdempotencyKey('shift-open'))
  const [cash, setCash] = useState<number | null>(lastClosed?.countedCash ?? 0)
  const [serverFieldError, setServerFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const fieldError = validateCashInput(cash, 'Tiền mặt đầu ca') ?? serverFieldError ?? undefined

  const mutation = useMutation({
    mutationFn: async () => {
      const opened = await openShift({ idem, openingCash: cash ?? 0 })
      // Tiếp tục nhận đơn SAU khi mở ca xong, ngay trong mutation (dialog còn sống để báo lỗi). Lỗi ở bước này không làm
      // hỏng ca vừa mở: thanh trên cùng vẫn còn nút "Tiếp tục nhận đơn".
      let resumeFailed = false
      if (askResume && resumeIntake) {
        try {
          await resumeOrderIntake()
        } catch (resumeError) {
          console.warn('[shift] đã mở ca nhưng không tiếp tục nhận đơn được:', resumeError)
          resumeFailed = true
        }
      }
      return { ...opened, resumedIntake: askResume && resumeIntake && !resumeFailed, resumeFailed }
    },
    onSuccess: async ({ resumed, resumedIntake, resumeFailed }) => {
      // Trạng thái thật luôn lấy từ /shift/current (replay idem của server có thể trả ảnh chụp cũ — D6).
      const actual = await applyOpened()
      if (!actual) {
        // Server không thấy ca mở (vd ca vừa chốt ở nơi khác sau khi replay): dùng mã mới để lần bấm sau mở ca thật.
        setIdem(createIdempotencyKey('shift-open'))
        setFailure('Chưa thấy ca đang mở trên máy chủ. Bấm Mở ca lại.')
        return
      }
      // `resumed` = ca đã có từ trước (vd mở ở tab khác): không báo lỗi, chỉ đóng dialog.
      useShiftUiStore.getState().clearRequest() // lần "Mở ca" thủ công từ widget đã xong
      pushToast(
        resumed ? `Đang tiếp tục ca #${actual.shiftId} đã mở trước đó.` : `Đã mở ca #${actual.shiftId}.`,
        resumed ? 'info' : 'success',
      )
      if (resumedIntake) pushToast('Đã tiếp tục nhận đơn.', 'success')
      if (resumeFailed) pushToast('Đã mở ca nhưng chưa tiếp tục nhận đơn được. Bấm Tiếp tục nhận đơn ở thanh trên cùng.')
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.code === 'INVALID_INPUT') {
        setServerFieldError(error.message)
        setFailure(null)
      } else if (error instanceof ApiError && error.code === 'idem_mismatch') {
        // Lần mở trước có thể đã thành công rồi mới sửa số tiền: mã mới ⇒ server trả lại ca đang mở (resumed).
        setIdem(createIdempotencyKey('shift-open'))
        setFailure('Lần mở ca trước chưa rõ kết quả. Bấm Mở ca lại để kiểm tra.')
      } else {
        setFailure(error.message || 'Không mở được ca. Thử lại.')
      }
    },
  })

  const submit = () => {
    if (mutation.isPending || fieldError) return
    setServerFieldError(null)
    setFailure(null)
    mutation.mutate()
  }

  return (
    <Dialog
      open
      size="sm"
      title="Mở ca làm việc"
      description="Nhập tiền mặt trong két lúc bắt đầu ca. Số này dùng để thối và hoàn tiền mặt, không phải doanh thu."
      hideClose
      // Thu ngân thường bắt buộc mở ca; admin thoát bằng nút "Chỉ xem". Esc/nền chỉ có tác dụng với admin.
      onClose={() => {
        if (canViewOnly && !mutation.isPending) onViewOnly()
      }}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="shift-dialog__logout"
            disabled={mutation.isPending}
            icon={<SignOut size={18} weight="bold" aria-hidden="true" />}
            loading={logoutPending}
            onClick={onLogout}
          >
            Đăng xuất
          </Button>
          {canViewOnly ? (
            <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onViewOnly}>
              Chỉ xem
            </Button>
          ) : null}
          <Button
            type="submit"
            form="shift-open-form"
            variant="primary"
            icon={<LockKeyOpen size={18} weight="bold" aria-hidden="true" />}
            loading={mutation.isPending}
            disabled={Boolean(fieldError)}
          >
            Mở ca
          </Button>
        </>
      }
    >
      <form
        id="shift-open-form"
        className="shift-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <dl className="shift-facts">
          <div>
            <dt>Nhân viên</dt>
            <dd>{staffName || '—'}</dd>
          </div>
          <div>
            <dt>Giờ máy chủ</dt>
            <dd>{serverTime ? formatShiftDateTime(serverTime) : '—'}</dd>
          </div>
        </dl>

        <MoneyInput
          label="Tiền mặt đầu ca"
          autoFocus
          value={cash}
          onChange={(value) => {
            setCash(value)
            setServerFieldError(null)
          }}
          error={fieldError}
          hint={
            lastClosed
              ? `Bàn giao từ ca #${lastClosed.shiftId} của ${lastClosed.staffName || 'nhân viên trước'}, chốt ${formatShiftDateTime(lastClosed.closeTime)} (${formatMoney(lastClosed.countedCash)}). Có thể sửa.`
              : 'Chưa có ca trước để bàn giao — nhập số tiền thực tế trong két (có thể để 0).'
          }
          disabled={mutation.isPending}
        />

        {askResume && orderPause ? (
          <div className="shift-resume-ask">
            <InlineAlert tone="warning">{pauseResumeQuestion(orderPause)}</InlineAlert>
            <label className="shift-check">
              <input
                type="checkbox"
                checked={resumeIntake}
                disabled={mutation.isPending}
                onChange={(event) => setResumeIntake(event.target.checked)}
              />
              Tiếp tục nhận đơn sau khi mở ca
            </label>
            <p className="shift-form__hint">
              Không chọn thì quán vẫn dừng nhận đơn; có thể bấm Tiếp tục nhận đơn sau ở thanh trên cùng của màn hình.
            </p>
          </div>
        ) : null}

        {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
        {canViewOnly ? null : (
          <p className="shift-form__hint">Cần mở ca để thu tiền. Muốn thoát hãy chọn Đăng xuất.</p>
        )}
      </form>
    </Dialog>
  )
}
