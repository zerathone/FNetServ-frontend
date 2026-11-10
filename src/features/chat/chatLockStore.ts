import { create } from 'zustand'
import { useAuthStore } from '../../store/auth'

/**
 * Khoá gửi tin do chống dồn tin (task chat-C9, handoff C7 mục 0.2): server khoá theo NHÂN VIÊN (không theo hội
 * thoại) nên trạng thái khoá phải nằm ngoài từng khung soạn — đổi hội thoại khung soạn dựng lại nhưng vẫn khoá.
 * Chỉ ở RAM: tải lại trang thì mất, khi đó server vẫn từ chối + trả `retryAfterSec` nên khoá lại đúng.
 */
type ChatLockState = {
  /** epoch ms; 0 hoặc ≤ now = không khoá. */
  lockedUntil: number
  lock: (seconds: number, now?: number) => void
  clear: () => void
}

export const useChatLockStore = create<ChatLockState>((set) => ({
  lockedUntil: 0,
  lock: (seconds, now = Date.now()) => set({ lockedUntil: now + Math.max(1, Math.ceil(seconds)) * 1000 }),
  clear: () => set({ lockedUntil: 0 }),
}))

// Đăng xuất / đổi tài khoản trên cùng tab (SPA không tải lại trang): khoá của người trước KHÔNG được dính sang
// người sau (server khoá theo staffId).
useAuthStore.subscribe((state, previous) => {
  if (state.token !== previous.token) useChatLockStore.getState().clear()
})
