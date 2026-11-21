// task work-shift S3b-FE — Ngừng / Tiếp tục nhận đơn (design mục 8b). Trạng thái nằm trong `/shift/current` (`orderPause`) nên
// KHÔNG thêm poll mới: dùng chu kỳ 60 giây của `useShift`; sau pause/resume chỉ `invalidateQueries(['shift','current'])`.
// Ở bước này máy chủ CHƯA chặn tạo đơn (S4b) — web chỉ hiện trạng thái và khoá nút tạo đơn của nhân viên như lớp UX.
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pauseOrderIntake, resumeOrderIntake } from '../../api/shift'
import { isIntakePaused, isManualPaused, pauseElapsedMinutes } from './shiftModel'
import { useShift } from './useShift'

const ELAPSED_TICK_MS = 30_000

/**
 * Chỉ để khoá nút tạo đơn: mode 0 / chưa biết / đang nhận đơn ⇒ false (không đổi hành vi nào so với trước).
 * Dùng thẳng `orderPause.on` — máy chủ đã tính sẵn (cờ thủ công, hoặc "không có ca" ở chế độ Bắt buộc); chế độ Ghi sổ có
 * `noShift = true` nhưng `on = false` ⇒ chỉ cảnh báo, không khoá.
 */
export function useIntakePaused(): boolean {
  const { orderPause } = useShift()
  return isIntakePaused(orderPause)
}

/** Số phút đã ngừng theo giờ máy chủ, tự cập nhật mỗi 30 giây; null khi không có cờ thủ công hoặc không tính được. */
export function usePauseElapsedMinutes(): number | null {
  const { orderPause, serverTime, dataUpdatedAt } = useShift()
  const [now, setNow] = useState(() => Date.now())
  const running = isManualPaused(orderPause)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => window.clearInterval(timer)
  }, [running])

  if (!running || !orderPause) return null
  return pauseElapsedMinutes(orderPause.manual.since, serverTime, dataUpdatedAt, now)
}

export function useOrderIntake() {
  const { enabled, orderPause } = useShift()
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shift', 'current'] })

  const pauseMutation = useMutation({
    mutationFn: (reason?: string) => pauseOrderIntake(reason),
    onSuccess: refresh,
    // Mất phản hồi vẫn có thể là máy chủ đã ngừng ⇒ đọc lại trạng thái thật.
    onError: refresh,
  })
  const resumeMutation = useMutation({
    mutationFn: () => resumeOrderIntake(),
    onSuccess: refresh,
    onError: refresh,
  })

  const paused = isIntakePaused(orderPause)
  const manualPaused = isManualPaused(orderPause)
  return {
    enabled,
    orderPause,
    /** Đang CHẶN nhận đơn (cờ thủ công hoặc "không có ca" ở chế độ Bắt buộc). */
    paused,
    /** Cờ thủ công còn bật (kể cả khi `noShift` cũng true). */
    manualPaused,
    /** Chỉ cờ thủ công mới bấm "Tiếp tục" được; "không có ca" tự hết khi có người mở ca. */
    canResume: manualPaused,
    pauseMutation,
    resumeMutation,
  }
}
