// task work-shift S2 — điểm cắm DUY NHẤT của hộp thoại ca vào MainLayout: Mở ca (tự hiện) và Chốt ca (khi Đăng xuất).
// `enabled = false` (INT_SHIFT_MODE = 0) ⇒ không render gì.
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

  if (closingShift) {
    return (
      <CloseShiftDialog shift={closingShift} onCancel={onCloseCancel} onLogout={onLogout} logoutPending={logoutPending} />
    )
  }
  if (!enabled) return null

  const showOpen = shift === null && workspaceId === 'pos' && (dismissedToken !== token || manualOpen)
  if (!showOpen) return null

  return (
    <OpenShiftDialog
      staffName={staffName}
      serverTime={serverTime}
      lastClosed={lastClosed}
      canViewOnly={isAdmin}
      onViewOnly={() => dismiss(token)}
      onLogout={onLogout}
      logoutPending={logoutPending}
    />
  )
}
