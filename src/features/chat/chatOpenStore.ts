import { create } from 'zustand'
import type { ChatConversation } from '../../api/chat'

/**
 * Yêu cầu "mở Chat Center vào thread này" từ nơi khác trong app (vd nút Nhắn tin ở drawer máy trạm).
 * `ChatCenter` (topbar) lắng nghe, mở Drawer + chọn hội thoại rồi `clear()`.
 */
type ChatOpenState = {
  request: { conversation: ChatConversation; seq: number } | null
  open: (conversation: ChatConversation) => void
  clear: () => void
}

let seq = 0

export const useChatOpenStore = create<ChatOpenState>((set) => ({
  request: null,
  // `seq` tăng mỗi lần ⇒ bấm lại cùng một máy khi Drawer đã đóng vẫn kích hoạt effect.
  open: (conversation) => set({ request: { conversation, seq: ++seq } }),
  clear: () => set({ request: null }),
}))
