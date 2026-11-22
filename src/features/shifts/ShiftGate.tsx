// task work-shift S2 — điểm cắm DUY NHẤT của hộp thoại ca vào MainLayout: Mở ca (tự hiện) và Chốt ca (khi Đăng xuất).
// `enabled = false` (INT_SHIFT_MODE = 0) ⇒ không render gì.
import { useEffect } from 'react'
import type { ShiftInfo } from '../../api/shift'
import { useAuthStore } from '../../store/auth'
import { CloseShiftDialog } from './CloseShiftDialog'
import { OpenShiftDialog } from './OpenShiftDialog'
import { useShift, useShiftUiStore } from './useShift'

type Props = {
  workspaceId: string
  /**
   * Ca đang được chốt (MainLayout đặt khi bấm Đăng xuất). Truyền NGUYÊN ca (không đọc lại từ cache) vì ngay sau khi chốt
   * cache đã `shift = null` mà màn kết quả vẫn phải sống tới khi bấm Đăng xuất.
   */
  closingShift: ShiftInfo | null
  onCloseCancel: () => void
  onLogout: () => void
  logoutPending: boolean
}

export function ShiftGate({ workspaceId, closingShift, onCloseCancel, onLogout, logoutPending }: Props) {
  const { enabled, shift, lastClosed, serverTime } = useShift()
  const token = useAuthStore((state) => state.token)
  const staffName = useAuthStore((state) => state.staffName)
  // Quản lý = admin (vai trò "Quản lý" ở MainLayout là `adminOnly`) — không đặt quy tắc mới (Q5).
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const dismissedToken = useShiftUiStore((state) => state.dismissedToken)
  const manualOpen = useShiftUiStore((state) => state.manualOpen)
  const dismiss = useShiftUiStore((state) => state.dismiss)
  const clearRequest = useShiftUiStore((state) => state.clearRequest)

  // Cờ "Mở ca" thủ công còn treo (vd ca được mở ở tab khác trong lúc hộp thoại đang chờ) sẽ làm hộp thoại tự bật lại ở BẤT KỲ
  // vai trò nào khi ca sau đó bị chốt ⇒ có ca là xoá cờ.
  const hasShift = shift !== null
  useEffect(() => {
    if (hasShift && manualOpen) clearRequest()
  }, [hasShift, manualOpen, clearRequest])

  if (closingShift) {
    return (
      <CloseShiftDialog shift={closingShift} onCancel={onCloseCancel} onLogout={onLogout} logoutPending={logoutPending} />
    )
  }
  if (!enabled) return null

  // `manualOpen` (bấm "Mở ca" ở widget / thẻ thông báo SHIFT_REQUIRED) mở được ở MỌI vai trò — quản lý cũng có thể bị chặn
  // thu tiền ở màn của mình; hộp thoại tự mở theo phiên chỉ ở vai trò Thu ngân như trước.
  const showOpen = shift === null && (manualOpen || (workspaceId === 'pos' && dismissedToken !== token))
  if (!showOpen) return null

  // Ngoài vai trò Thu ngân (hộp thoại chỉ do bấm tay / thẻ thông báo mở) ai cũng được đóng lại; ở Thu ngân giữ y hệt trước
  // (bắt buộc mở ca, chỉ admin được "Chỉ xem"). "Chỉ xem" ngoài Thu ngân chỉ xoá yêu cầu, KHÔNG đánh dấu đã bỏ qua cho phiên.
  const inPos = workspaceId === 'pos'
  return (
    <OpenShiftDialog
      staffName={staffName}
      serverTime={serverTime}
      lastClosed={lastClosed}
      canViewOnly={isAdmin || !inPos}
      onViewOnly={() => (inPos ? dismiss(token) : clearRequest())}
      onLogout={onLogout}
      logoutPending={logoutPending}
    />
  )
}
