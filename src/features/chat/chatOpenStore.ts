import { create } from 'zustand'
import type { ChatConversation } from '../../api/chat'

/**
 * Yêu cầu "mở Chat Center vào thread này" từ nơi khác trong app (vd nút Nhắn tin ở drawer máy trạm, bấm toast tin mới).
 * `ChatCenter` (topbar) lắng nghe, mở Drawer + chọn hội thoại rồi `clear()`.
 *
 * `viewingConvId` ngược lại: ChatCenter báo hội thoại ĐANG xem (Drawer mở + đã chọn thread) để toast tin mới
 * không báo trùng cái người dùng đang đọc.
 */
type ChatOpenState = {
  request: { conversation: ChatConversation; seq: number } | null
  viewingConvId: string | null
  open: (conversation: ChatConversation) => void
  clear: () => void
  setViewing: (convId: string | null) => void
}

let seq = 0

export const useChatOpenStore = create<ChatOpenState>((set) => ({
  request: null,
  viewingConvId: null,
  // `seq` tăng mỗi lần ⇒ bấm lại cùng một máy khi Drawer đã đóng vẫn kích hoạt effect.
  open: (conversation) => set({ request: { conversation, seq: ++seq } }),
  clear: () => set({ request: null }),
  setViewing: (viewingConvId) => set({ viewingConvId }),
}))
