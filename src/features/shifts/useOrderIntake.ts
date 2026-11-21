// task work-shift S3b-FE — Ngừng / Tiếp tục nhận đơn (design mục 8b). Trạng thái nằm trong `/shift/current` (`orderPause`) nên
// KHÔNG thêm poll mới: dùng chu kỳ 60 giây của `useShift`; sau pause/resume chỉ `invalidateQueries(['shift','current'])`.
// Ở bước này máy chủ CHƯA chặn tạo đơn (S4b) — web chỉ hiện trạng thái và khoá nút tạo đơn của nhân viên như lớp UX.
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pauseOrderIntake, resumeOrderIntake } from '../../api/shift'
import { isIntakePaused, pauseElapsedMinutes } from './shiftModel'
import { useShift } from './useShift'

const ELAPSED_TICK_MS = 30_000

/**
 * Chỉ để khoá nút tạo đơn: mode 0 / chưa biết / đang nhận đơn ⇒ false (không đổi hành vi nào so với trước).
 * Nguồn tự động "không có ca" (`no_shift`) chỉ khoá khi chế độ Bắt buộc (2): ở Ghi sổ (1) máy chủ chỉ ghi "would-block".
 */
export function useIntakePaused(): boolean {
  const { orderPause, mode } = useShift()
  return isIntakePaused(orderPause) && (orderPause?.source === 'manual' || mode >= 2)
}

/** Số phút đã ngừng theo giờ máy chủ, tự cập nhật mỗi 30 giây; null khi không ngừng hoặc không tính được. */
export function usePauseElapsedMinutes(): number | null {
  const { orderPause, serverTime, dataUpdatedAt } = useShift()
  const [now, setNow] = useState(() => Date.now())
  const running = isIntakePaused(orderPause) && orderPause?.source === 'manual'

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => window.clearInterval(timer)
  }, [running])

  if (!running || !orderPause) return null
  return pauseElapsedMinutes(orderPause.since, serverTime, dataUpdatedAt, now)
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
  return {
    enabled,
    orderPause,
    paused,
    /** Chỉ cờ thủ công mới bấm "Tiếp tục" được; nguồn tự động (không có ca) tự hết khi có người mở ca. */
    canResume: paused && orderPause?.source === 'manual',
    pauseMutation,
    resumeMutation,
  }
}
