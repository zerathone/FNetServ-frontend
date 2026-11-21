// task work-shift S3 (F2) — truy vấn cho trang quản lý /shifts. Cùng tiền tố key ['shift', ...] với `useShift` ⇒ mở/chốt ca
// (invalidate ['shift']) tự làm mới trang. Polling 30 giây CHỈ khi đang xem hôm nay (ngày quá khứ không đổi) — KNOWLEDGE §65.
// Mọi key gắn `staffId`: cache không bị xoá khi đăng xuất, nhân viên đăng nhập sau không được thấy doanh thu mọi ca của người trước.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ApiError, RbacDeniedError } from '../../api/client'
import { getShiftPayments, getShiftStock, listShifts, reconcileShifts } from '../../api/shift'
import { useAuthStore } from '../../store/auth'
import { PAYMENTS_PAGE_SIZE, SHIFT_LIST_POLL_MS, classifyShiftError, isTodayYmd } from './shiftManageModel'

export const shiftListKey = (staffId: number | null, date: string) => ['shift', 'list', staffId, date] as const
export const shiftReconcileKey = (staffId: number | null, date: string) => ['shift', 'reconcile', staffId, date] as const

export function shiftErrorKind(error: unknown) {
  return classifyShiftError({
    rbac: error instanceof RbacDeniedError,
    code: error instanceof ApiError ? error.code : undefined,
    httpStatus: error instanceof ApiError ? error.httpStatus : undefined,
  })
}

/**
 * Chỉ poll khi xem hôm nay; lỗi CỐ ĐỊNH (không quyền / chưa bật chế độ ca) thì dừng poll — tránh bắn toast 403 mỗi 30 giây.
 * Lỗi mạng tạm thời vẫn poll tiếp để tự hồi phục.
 */
const pollWhenToday = (date: string) => (query: { state: { error: unknown } }) => {
  if (!isTodayYmd(date)) return false
  return query.state.error && shiftErrorKind(query.state.error) !== 'other' ? false : SHIFT_LIST_POLL_MS
}

export function useShiftList(date: string, enabled: boolean) {
  const staffId = useAuthStore((state) => state.staffId)
  return useQuery({
    queryKey: shiftListKey(staffId, date),
    queryFn: () => listShifts({ date }),
    enabled,
    staleTime: 10_000,
    refetchInterval: pollWhenToday(date),
    retry: false,
  })
}

export function useShiftReconcile(date: string, enabled: boolean) {
  const staffId = useAuthStore((state) => state.staffId)
  return useQuery({
    queryKey: shiftReconcileKey(staffId, date),
    queryFn: () => reconcileShifts(date),
    enabled,
    staleTime: 10_000,
    refetchInterval: pollWhenToday(date),
    retry: false,
  })
}

/** Danh sách giao dịch của một ô nguồn × hình thức; phân trang phía máy chủ (50 dòng/trang). */
export function useShiftPayments(params: {
  shiftId: number
  source?: string
  method?: string
  page: number
  enabled: boolean
}) {
  const { shiftId, source, method, page, enabled } = params
  const staffId = useAuthStore((state) => state.staffId)
  return useQuery({
    queryKey: ['shift', 'payments', staffId, shiftId, source ?? '', method ?? '', page] as const,
    queryFn: () =>
      getShiftPayments({ shiftId, source, method, limit: PAYMENTS_PAGE_SIZE, offset: page * PAYMENTS_PAGE_SIZE }),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useShiftStock(shiftId: number, enabled: boolean) {
  const staffId = useAuthStore((state) => state.staffId)
  return useQuery({
    queryKey: ['shift', 'stock', staffId, shiftId] as const,
    queryFn: () => getShiftStock(shiftId),
    enabled,
    staleTime: 15_000,
    retry: false,
  })
}
