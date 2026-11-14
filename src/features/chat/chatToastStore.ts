import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatConversation } from '../../api/chat'
import { isMuted, needsReply, type DismissedMap } from './chatToastModel'

/**
 * Trạng thái toast tin nhắn — chỉ là tuỳ chọn hiển thị của PHIÊN ĐĂNG NHẬP này.
 *  - `mutedUntil` + `mutedSessionId`: tạm tắt chỉ có hiệu lực trong đúng phiên đã bấm. Lưu `sessionStorage` (cùng nơi
 *    lưu token ⇒ F5 trong phiên vẫn đang tắt, đóng trình duyệt thì mất), gắn `sessionId` (đổi tài khoản ⇒ vô hiệu) và
 *    xoá khi đăng xuất (`resetSession`).
 *  - `dismissed` / `baselined`: chỉ trong RAM. Mỗi lần mở trang "chốt" các tin đang chưa đọc là đã thấy (không bung
 *    cả chục toast cũ khi F5); từ đó chỉ tin MỚI hơn mới ra toast.
 */
type ChatToastState = {
  mutedUntil: number | null
  mutedSessionId: string | null
  dismissed: DismissedMap
  baselined: boolean
  /** Bấm X: ẩn toast của hội thoại này đến khi có tin mới hơn `lastId`. */
  dismiss: (convId: string, lastId: number) => void
  /** Lần tải đầu: coi mọi tin chưa đọc hiện có là đã thấy. */
  baseline: (items: ReadonlyArray<ChatConversation>) => void
  mute: (durationMs: number, sessionId: string, now?: number) => void
  unmute: () => void
  /** Đăng xuất / đổi tài khoản: quên toàn bộ trạng thái phiên (kể cả tạm tắt). */
  resetSession: () => void
}

const STORAGE_KEY = 'fnet-chat-toast-v1'

// Bản trước lưu tạm tắt ở localStorage (sống qua đăng xuất) — dọn để không còn mốc cũ nằm đó.
try {
  localStorage.removeItem(STORAGE_KEY)
} catch {
  // trình duyệt chặn storage: bỏ qua
}

export const useChatToastStore = create<ChatToastState>()(
  persist(
    (set) => ({
      mutedUntil: null,
      mutedSessionId: null,
      dismissed: {},
      baselined: false,
      dismiss: (convId, lastId) =>
        set((state) =>
          lastId > (state.dismissed[convId] ?? 0)
            ? { dismissed: { ...state.dismissed, [convId]: lastId } }
            : state,
        ),
      baseline: (items) =>
        set((state) => {
          const dismissed: Record<string, number> = { ...state.dismissed }
          for (const item of items) {
            if (needsReply(item) && item.lastId > (dismissed[item.convId] ?? 0)) dismissed[item.convId] = item.lastId
          }
          return { dismissed, baselined: true }
        }),
      mute: (durationMs, sessionId, now = Date.now()) =>
        set({ mutedUntil: now + durationMs, mutedSessionId: sessionId }),
      unmute: () => set({ mutedUntil: null, mutedSessionId: null }),
      resetSession: () => set({ dismissed: {}, baselined: false, mutedUntil: null, mutedSessionId: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ mutedUntil: state.mutedUntil, mutedSessionId: state.mutedSessionId }),
      // Mốc đã quá hạn khi tải lại trang ⇒ bỏ luôn.
      merge: (persisted, current) => {
        const saved = persisted as { mutedUntil?: unknown; mutedSessionId?: unknown } | undefined
        const valid =
          typeof saved?.mutedUntil === 'number' &&
          typeof saved?.mutedSessionId === 'string' &&
          isMuted(saved.mutedUntil, Date.now())
        return {
          ...current,
          mutedUntil: valid ? (saved.mutedUntil as number) : null,
          mutedSessionId: valid ? (saved.mutedSessionId as string) : null,
        }
      },
    },
  ),
)
