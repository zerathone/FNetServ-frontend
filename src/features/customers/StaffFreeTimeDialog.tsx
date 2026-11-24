import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Timer } from '@phosphor-icons/react'
import { usersApi } from '../../api/users'
import { Button, Dialog } from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { pushToast } from '../../store/toast'
import { isRbacDenied } from './userAdminModel'
import {
  FREE_TIME_PRESETS,
  describeGiveFreeTimeError,
  describeParsedMinutes,
  formatMinutes,
  parseMinutes,
} from './staffFreeTimeModel'

const NOTE_MAX = 200

type Props = {
  open: boolean
  userId: number
  /** Tên hiển thị trong tiêu đề phụ (họ tên nếu có, không thì tên đăng nhập). */
  displayName: string
  onClose: () => void
}

/**
 * Tặng THỜI GIAN miễn phí (phút) cho nhân viên — POST /user/give-free-time (parity CEmployeeList::OnGivetime).
 * Cùng một ý định (cùng nhân viên + số phút + ghi chú) giữ nguyên `idem` qua lỗi mạng/bấm lại: server không cộng 2 lần.
 */
export function StaffFreeTimeDialog({ open, userId, displayName, onClose }: Props) {
  const [minutesText, setMinutesText] = useState('')
  const [note, setNote] = useState('')
  // getKey/clearKey ổn định (useCallback); object trả về thì không ⇒ không đưa nguyên object vào deps.
  const { getKey, clearKey } = useIdempotentIntent('staff-freetime')

  // Mở lại (hoặc đổi nhân viên) ⇒ form sạch, không thừa số phút của lần trước.
  useEffect(() => {
    if (open) {
      setMinutesText('')
      setNote('')
      clearKey()
    }
  }, [open, userId, clearKey])

  const parsed = parseMinutes(minutesText)
  const hint = describeParsedMinutes(parsed)
  const canSubmit = parsed.ok && note.length <= NOTE_MAX

  const mutation = useMutation({
    mutationFn: () => {
      if (!parsed.ok) throw new Error('Số phút không hợp lệ.')
      const trimmedNote = note.trim()
      const idem = getKey(fingerprintIntent({ userId, minutes: parsed.minutes, note: trimmedNote }))
      return usersApi.giveFreeTime({
        userId,
        minutes: parsed.minutes,
        idem,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      })
    },
    onSuccess: () => {
      if (parsed.ok) pushToast(`Đã tặng ${formatMinutes(parsed.minutes)} cho ${displayName}.`, 'success')
      clearKey()
      onClose()
    },
    onError: (error: Error & { httpStatus?: number }) => {
      if (isRbacDenied(error)) return // thông báo thiếu quyền đã được hiện chung
      pushToast(describeGiveFreeTimeError(error), 'error')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      title="Tặng thời gian miễn phí"
      description={displayName}
      size="sm"
      onClose={() => {
        if (!mutation.isPending) onClose()
      }}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="submit"
            form="staff-free-time-form"
            variant="primary"
            icon={<Timer size={18} weight="bold" aria-hidden="true" />}
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            {parsed.ok ? `Tặng ${formatMinutes(parsed.minutes)}` : 'Tặng thời gian'}
          </Button>
        </>
      }
    >
      <form id="staff-free-time-form" className="staff-free-time" onSubmit={submit}>
        <label className="ds-field">
          <span className="ds-field__label">Số phút</span>
          <input
            className="ds-input staff-free-time__input"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="Ví dụ 120"
            value={minutesText}
            aria-describedby="staff-free-time-hint"
            aria-invalid={Boolean(minutesText) && !parsed.ok}
            // Chỉ giữ chữ số; chặn dán chuỗi dài vô nghĩa.
            onChange={(event) => setMinutesText(event.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          <small
            id="staff-free-time-hint"
            className={`ds-field__hint staff-free-time__hint${parsed.ok ? ' is-ok' : ''}`}
            aria-live="polite"
          >
            {hint || 'Nhập số phút hoặc chọn nhanh bên dưới.'}
          </small>
        </label>

        <div className="staff-free-time__presets" role="group" aria-label="Chọn nhanh số phút">
          {FREE_TIME_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className="staff-free-time__preset"
              aria-pressed={parsed.ok && parsed.minutes === preset.minutes}
              onClick={() => setMinutesText(String(preset.minutes))}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <label className="ds-field">
          <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
          <input
            className="ds-input"
            value={note}
            maxLength={NOTE_MAX}
            placeholder="Lý do tặng"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </form>
    </Dialog>
  )
}
