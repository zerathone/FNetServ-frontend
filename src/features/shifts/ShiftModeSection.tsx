// task work-shift S3b-FE (D2, user chốt 2026-11-21) — Cài đặt → "Ca làm việc": công tắc chế độ ca (GET|PUT /settings/shift-mode).
// Mọi nhân viên xem được; CHỈ admin đổi được (máy chủ kiểm cứng). Đổi sang "Bắt buộc mở ca" phải xác nhận.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../api/client'
import { getShiftMode, setShiftMode } from '../../api/shift'
import { Button, ConfirmAction, InlineAlert, RadioCards, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { SHIFT_MODE_OPTIONS, describeShiftModeError, shiftModeFromValue, shiftModeToValue } from './shiftModeModel'
import './shifts.css'

/** Key bắt đầu bằng 'shift' ⇒ `invalidateQueries(['shift'])` (mở/chốt ca, đổi chế độ) làm mới luôn. */
const SHIFT_MODE_QUERY_KEY = ['shift', 'mode'] as const

export function ShiftModeSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: SHIFT_MODE_QUERY_KEY, queryFn: getShiftMode, retry: false, staleTime: 0 })
  const [pendingMode, setPendingMode] = useState<number | null>(null)
  const [failure, setFailure] = useState('')

  const mutation = useMutation({
    mutationFn: (mode: number) => setShiftMode(mode),
    onSuccess: async (saved) => {
      setFailure('')
      setPendingMode(null)
      queryClient.setQueryData(SHIFT_MODE_QUERY_KEY, saved)
      // Đọc lại mọi thứ về ca (kể cả /shift/current ⇒ widget / hộp thoại Mở ca bật hoặc tắt ngay trên máy này).
      await queryClient.invalidateQueries({ queryKey: ['shift'] })
      const label = SHIFT_MODE_OPTIONS.find((item) => item.mode === saved.mode)?.label ?? ''
      // `changed = false`: máy chủ đã ở đúng chế độ này (đổi từ máy khác) ⇒ không ghi nhật ký, nói đúng sự thật.
      pushToast(
        saved.changed === false ? `Chế độ ca đã là "${label}" từ trước.` : `Đã đổi chế độ ca sang "${label}".`,
        saved.changed === false ? 'info' : 'success',
      )
    },
    onError: (error: Error) => {
      setPendingMode(null)
      setFailure(describeShiftModeError(error instanceof ApiError ? { code: error.code, httpStatus: error.httpStatus, message: error.message } : { message: error.message }))
      // Mất phản hồi vẫn có thể là máy chủ đã đổi ⇒ đọc lại giá trị thật.
      void queryClient.invalidateQueries({ queryKey: ['shift'] })
    },
  })

  const current = query.data
  const choose = (mode: number) => {
    if (!isAdmin || mutation.isPending || !current || mode === current.mode) return
    setFailure('')
    // Bắt buộc mở ca ảnh hưởng thu tiền ⇒ hỏi lại; Tắt / Ghi sổ đổi ngay.
    if (mode === 2) setPendingMode(2)
    else mutation.mutate(mode)
  }

  const effectiveDiffers = current !== undefined && current.effective !== current.mode

  return (
    <section className="settings-section" aria-labelledby="shift-mode-title">
      <header>
        <h2 id="shift-mode-title">Chế độ ca làm việc</h2>
        <p>
          Quy định thu ngân có phải mở ca trước khi thu tiền hay không. Mở ca, chốt ca và báo cáo từng ca hoạt động từ chế độ
          Ghi sổ trở lên.
        </p>
      </header>

      {query.isLoading ? (
        <StateView title="Đang tải chế độ ca" />
      ) : query.isError || !current ? (
        <StateView
          title="Không tải được chế độ ca"
          description={
            query.error
              ? describeShiftModeError(
                  query.error instanceof ApiError
                    ? { code: query.error.code, httpStatus: query.error.httpStatus, message: query.error.message }
                    : { message: (query.error as Error).message },
                )
              : 'Máy chủ chưa hỗ trợ cài đặt này (cần cập nhật Server).'
          }
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : (
        <div className="shift-form">
          {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi chế độ ca.</InlineAlert>}

          <RadioCards
            ariaLabel="Chế độ ca làm việc"
            value={shiftModeToValue(current.mode)}
            disabled={!isAdmin || mutation.isPending}
            options={SHIFT_MODE_OPTIONS.map((item) => ({
              value: shiftModeToValue(item.mode),
              label: item.label,
              description: item.summary,
            }))}
            onChange={(value) => choose(shiftModeFromValue(value))}
          />

          {effectiveDiffers ? (
            <InlineAlert tone="info">
              Máy chủ hiện áp dụng như chế độ <strong>{SHIFT_MODE_OPTIONS.find((item) => item.mode === current.effective)?.label}</strong>
              : việc chặn thu tiền khi chưa mở ca chưa có hiệu lực ở phiên bản này.
            </InlineAlert>
          ) : null}

          {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
        </div>
      )}

      <ConfirmAction
        open={pendingMode === 2}
        danger
        title="Bật chế độ Bắt buộc mở ca?"
        description="Thu ngân không có ca đang mở sẽ không thu tiền được."
        confirmLabel="Bắt buộc mở ca"
        pending={mutation.isPending}
        onCancel={() => setPendingMode(null)}
        onConfirm={() => mutation.mutate(2)}
      >
        <InlineAlert tone="warning">
          Trước khi bật, hãy báo thu ngân mở ca đầu giờ. Hiệu lực chặn thu tiền thật chỉ có từ phiên bản máy chủ có bước
          chặn thu tiền; trước đó chế độ này hoạt động như Ghi sổ.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
