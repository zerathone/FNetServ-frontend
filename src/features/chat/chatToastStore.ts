import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatConversation } from '../../api/chat'
import { isMuted, type DismissedMap } from './chatToastModel'

/**
 * Trạng thái toast tin nhắn — chỉ là tuỳ chọn hiển thị của máy thu ngân này.
 *  - `mutedUntil`: lưu localStorage (tải lại trang vẫn đang tắt), hết hạn thì coi như không tắt.
 *  - `dismissed` / `baselined`: chỉ trong RAM. Mỗi lần mở trang "chốt" các tin đang chưa đọc là đã thấy (không bung
 *    cả chục toast cũ khi F5); từ đó chỉ tin MỚI hơn mới ra toast.
 */
type ChatToastState = {
  mutedUntil: number | null
  dismissed: DismissedMap
  baselined: boolean
  /** Bấm X: ẩn toast của hội thoại này đến khi có tin mới hơn `lastId`. */
  dismiss: (convId: string, lastId: number) => void
  /** Lần tải đầu: coi mọi tin chưa đọc hiện có là đã thấy. */
  baseline: (items: ReadonlyArray<ChatConversation>) => void
  mute: (durationMs: number, now?: number) => void
  unmute: () => void
  /** Đăng xuất / đổi tài khoản: quên trạng thái RAM để lần đăng nhập sau chốt lại từ đầu. */
  resetSession: () => void
}

export const useChatToastStore = create<ChatToastState>()(
  persist(
    (set) => ({
      mutedUntil: null,
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
            if (item.unread > 0 && item.lastId > (dismissed[item.convId] ?? 0)) dismissed[item.convId] = item.lastId
          }
          return { dismissed, baselined: true }
        }),
      mute: (durationMs, now = Date.now()) => set({ mutedUntil: now + durationMs }),
      unmute: () => set({ mutedUntil: null }),
      resetSession: () => set({ dismissed: {}, baselined: false }),
    }),
    {
      name: 'fnet-chat-toast-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mutedUntil: state.mutedUntil }),
      // Mốc đã quá hạn khi tải lại trang ⇒ bỏ luôn.
      merge: (persisted, current) => {
        const mutedUntil = (persisted as { mutedUntil?: unknown } | undefined)?.mutedUntil
        return {
          ...current,
          mutedUntil:
            typeof mutedUntil === 'number' && isMuted(mutedUntil, Date.now()) ? mutedUntil : null,
        }
      },
    },
  ),
)
