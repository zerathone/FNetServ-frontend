// task work-shift S2 (F1) — MỘT nguồn duy nhất cho trạng thái ca của nhân viên đang đăng nhập.
// React Query: cả MainLayout, widget, dialog và các trang khác dùng chung 1 query ⇒ không nhân request (KNOWLEDGE §65).
import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { getShiftCurrent, getShiftSummary, type ShiftCurrent, type ShiftInfo } from '../../api/shift'
import { useAuthStore } from '../../store/auth'
import { statsScopeFor, type ShiftScope } from './shiftScopeModel'

/** Key theo staffId: logout/login đổi người trong cùng tab không được thấy ca của người trước (cache không bị xoá khi logout). */
export const shiftCurrentKey = (staffId: number | null) => ['shift', 'current', staffId] as const
export const shiftSummaryKey = (staffId: number | null, shiftId: number | null) => ['shift', 'summary', staffId, shiftId] as const

const POLL_MS = 60_000

export function useShift() {
  const token = useAuthStore((state) => state.token)
  const staffId = useAuthStore((state) => state.staffId)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: shiftCurrentKey(staffId),
    queryFn: getShiftCurrent,
    enabled: Boolean(token),
    // mode = 0 ⇒ Infinity: đúng một lần /shift/current mỗi phiên (không refetch khi mount observer mới / focus lại tab).
    // Lỗi mạng (chưa có data) ⇒ 5 phút, và không thử lại mỗi lần có component mount: coi như chưa biết.
    staleTime: (q) => (q.state.data ? (q.state.data.enabled ? 30_000 : Infinity) : 300_000),
    retryOnMount: false,
    // mode = 0 (hoặc chưa biết) ⇒ KHÔNG poll.
    refetchInterval: (q) => (q.state.data?.enabled ? POLL_MS : false),
    retry: false,
  })

  // Lỗi mạng ⇒ coi như chưa biết: không bật dialog, không chặn đăng xuất; chỉ ghi vết.
  useEffect(() => {
    if (query.error) console.warn('[shift] không đọc được /shift/current — bỏ qua giao diện ca:', query.error)
  }, [query.error])

  const data = query.data
  const enabled = data?.enabled === true

  /**
   * Sau mở ca thành công: KHÔNG tin `shift` trong response /shift/open (replay RAM trả ảnh chụp lúc mở — S1 design mục 14 D6),
   * luôn đọc lại /shift/current. Trả ca thật (null nếu server không thấy ca mở, vd ca vừa bị chốt ở nơi khác).
   */
  const applyOpened = useCallback(async (): Promise<ShiftInfo | null> => {
    await queryClient.invalidateQueries({ queryKey: ['shift'] })
    return queryClient.getQueryData<ShiftCurrent>(shiftCurrentKey(staffId))?.shift ?? null
  }, [queryClient, staffId])

  /** Sau chốt ca thành công. */
  const applyClosed = useCallback(() => {
    queryClient.setQueryData<ShiftCurrent>(shiftCurrentKey(staffId), (old) => (old ? { ...old, shift: null } : old))
    void queryClient.invalidateQueries({ queryKey: ['shift'] })
  }, [queryClient, staffId])

  return {
    enabled,
    mode: enabled ? (data?.mode ?? 0) : 0,
    shift: enabled ? (data?.shift ?? null) : null,
    lastClosed: enabled ? (data?.lastClosed ?? null) : null,
    serverTime: data?.serverTime ?? '',
    /** Ngừng nhận đơn (S3b-FE): null khi mode 0 / máy chủ không gửi. `on` cho biết có đang ngừng hay không. */
    orderPause: enabled ? (data?.orderPause ?? null) : null,
    /** Mốc (ms) tải /shift/current gần nhất — để tính "đã ngừng bao lâu" theo giờ máy chủ. */
    dataUpdatedAt: query.dataUpdatedAt,
    isLoading: query.isLoading,
    applyOpened,
    applyClosed,
  }
}

/** Tóm tắt ca (tính live ở server) — widget, Drawer và Dialog Chốt ca dùng chung key ⇒ một request / 60 giây. */
export function useShiftSummary(shiftId: number | null, enabled = true, poll: boolean | number = true) {
  const staffId = useAuthStore((state) => state.staffId)
  return useQuery({
    queryKey: shiftSummaryKey(staffId, shiftId),
    queryFn: () => getShiftSummary(shiftId ?? undefined),
    enabled: enabled && shiftId !== null,
    staleTime: 15_000,
    // `poll = false`: ca đã chốt (trang quản lý) — số đã chụp, không đổi nên không cần hỏi lại mỗi phút.
    // `poll = <ms>`: chu kỳ riêng (widget Nguồn thu ca hỏi 30 giây như trước). Lưu ý: mỗi observer có timer riêng — chỉ khi
    // các lần gọi trùng thời điểm thì mới gộp thành một request, nên ở vai trò Thu ngân có tối đa vài request/phút tới route này.
    refetchInterval: poll === true ? POLL_MS : poll === false ? false : poll,
    retry: false,
  })
}

/**
 * Cửa sổ lọc đơn combo chờ duyệt (Q18): `mode ≥ 1` ⇒ 0 (không lọc thời gian, thấy đủ đơn mà ca có thể chặn chốt);
 * `mode = 0` ⇒ undefined = KHÔNG gửi tham số (request y hệt trước khi có ca, server tự lọc 24 giờ).
 */
export function usePendingComboHours(): number | undefined {
  const { mode } = useShift()
  return mode >= 1 ? 0 : undefined
}

/**
 * `scope` cho các ô thống kê (S5): `'shift'` khi chế độ ca bật và người dùng có ca mở, còn lại undefined (⇒ KHÔNG gửi
 * `scope`, lời gọi y hệt trước). Dùng chung query `/shift/current` của `useShift` nên không thêm request.
 * Đưa kết quả vào `queryKey` để số theo ca và số 24 giờ không lẫn cache.
 */
export function useStatsScope(): ShiftScope | undefined {
  const { enabled, shift } = useShift()
  return statsScopeFor({ enabled, shift })
}

// ---------------------------------------------------------------------------------------------
// Trạng thái giao diện theo PHIÊN ĐĂNG NHẬP (không localStorage): "Chỉ xem" xong thì không hỏi mở ca lại tới lần đăng
// nhập sau. Gắn với token nên đăng nhập lại (token mới) tự reset.
// ---------------------------------------------------------------------------------------------

type ShiftUiState = {
  dismissedToken: string | null
  /** Widget bấm "Mở ca" ⇒ mở lại Dialog dù đã "Chỉ xem". */
  manualOpen: boolean
  dismiss: (token: string | null) => void
  requestOpen: () => void
  clearRequest: () => void
}

export const useShiftUiStore = create<ShiftUiState>((set) => ({
  dismissedToken: null,
  manualOpen: false,
  dismiss: (token) => set({ dismissedToken: token, manualOpen: false }),
  requestOpen: () => set({ manualOpen: true }),
  clearRequest: () => set({ manualOpen: false }),
}))
