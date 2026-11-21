// task work-shift S3 (F2) — Đóng cưỡng bức một ca đang mở (lối thoát cho ca bị kẹt / quên chốt, Q6).
// Ghi chú BẮT BUỘC 1–500 ký tự (server kiểm `isSqlSafeText`: từ chối ' \ và ký tự điều khiển). Server KHÔNG kiểm đơn chờ duyệt.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { forceCloseShift, type ShiftListItem } from '../../api/shift'
import { ConfirmAction, InlineAlert } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { MAX_SHIFT_NOTE, formatMoney, formatShiftDateTime, sanitizeNoteInput } from './shiftModel'
import { validateForceCloseNote } from './shiftManageModel'
import './shifts.css'

type Props = {
  shift: ShiftListItem
  onCancel: () => void
  /** Đã đóng xong (hoặc ca đã được đóng từ trước) — trang tự refetch danh sách. */
  onDone: () => void
}

export function ForceCloseDialog({ shift, onCancel, onDone }: Props) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const noteError = validateForceCloseNote(note)
  // Chưa gõ gì thì chưa báo lỗi (tránh khung đỏ ngay khi mở); nút xác nhận vẫn khoá.
  const shownError = touched || note.length > 0 ? noteError : undefined

  const mutation = useMutation({
    mutationFn: () => forceCloseShift({ shiftId: shift.shiftId, note: sanitizeNoteInput(note).trim() }),
    onSuccess: (result) => {
      pushToast(
        result.alreadyClosed ? `Ca #${shift.shiftId} đã được đóng từ trước.` : `Đã đóng cưỡng bức ca #${shift.shiftId}.`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['shift'] })
      onDone()
    },
    onError: (error: Error) => {
      // Mất phản hồi (timeout) vẫn có thể là server đã đóng ca ⇒ làm mới danh sách để thấy trạng thái thật.
      setFailure(error.message || 'Không đóng được ca.')
      void queryClient.invalidateQueries({ queryKey: ['shift'] })
    },
  })

  // Ref chặn bấm hai lần liên tiếp trước khi React kịp render lại `isPending`.
  const inFlight = useRef(false)
  const submit = () => {
    setTouched(true)
    if (inFlight.current || mutation.isPending || noteError) return
    setFailure(null)
    inFlight.current = true
    mutation.mutate(undefined, {
      onSettled: () => {
        inFlight.current = false
      },
    })
  }

  return (
    <ConfirmAction
      open
      danger
      size="md"
      title={`Đóng cưỡng bức ca #${shift.shiftId}`}
      description={`${shift.staffName || 'Nhân viên'} · mở lúc ${formatShiftDateTime(shift.openTime)}`}
      confirmLabel="Đóng cưỡng bức"
      cancelLabel="Hủy"
      pending={mutation.isPending}
      confirmDisabled={Boolean(noteError)}
      onCancel={onCancel}
      onConfirm={submit}
    >
      <div className="shift-form">
        <InlineAlert tone="warning">
          Ca sẽ được chốt ngay với số liệu hiện tại ({formatMoney(shift.revenue)} doanh thu), <strong>không</strong> kiểm
          đơn đang chờ duyệt và không có tiền thực đếm. Nhân viên không đóng lại được ca này. Thao tác được ghi vào nhật
          ký máy chủ.
        </InlineAlert>
        <label className="ds-field">
          <span className="ds-field__label">Lý do đóng cưỡng bức (bắt buộc)</span>
          <textarea
            className="ds-input"
            rows={3}
            maxLength={MAX_SHIFT_NOTE}
            value={note}
            disabled={mutation.isPending}
            aria-invalid={Boolean(shownError)}
            aria-required="true"
            placeholder="Ví dụ: nhân viên về mà quên chốt ca"
            // Enter không chèn xuống dòng: server từ chối ký tự điều khiển trong ghi chú.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
            onBlur={() => setTouched(true)}
            onChange={(event) => setNote(sanitizeNoteInput(event.target.value))}
          />
          {shownError ? (
            <span className="ds-field__error">{shownError}</span>
          ) : (
            <span className="ds-field__hint">{note.length}/{MAX_SHIFT_NOTE}</span>
          )}
        </label>
        {failure ? <InlineAlert tone="danger">{failure} Hãy kiểm tra lại trạng thái ca trong danh sách rồi thử lại nếu ca còn mở.</InlineAlert> : null}
      </div>
    </ConfirmAction>
  )
}
