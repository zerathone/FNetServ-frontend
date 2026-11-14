import type { ChatConversation } from '../../api/chat'

/**
 * Toast tin nhắn của khách (góc dưới phải) — kiểu thông báo trên màn hình khóa điện thoại. Phần thuần để test được;
 * store ở chatToastStore.ts, UI ở ChatToastHost.tsx.
 *
 * Nguồn sự thật là danh sách hội thoại CHƯA ĐỌC từ server (REST), không phải từng tín hiệu WS:
 *  - mỗi tài khoản đúng 1 toast = tin cuối + số tin chưa đọc (badge trên avatar), tin dồn tới chỉ làm toast cập nhật;
 *  - toast KHÔNG tự tắt (khách cần được phục vụ); biến mất khi tin được đọc ở bất cứ đâu (Chat Center, MFC), hoặc người
 *    dùng bấm X (ẩn đến khi có tin MỚI hơn), hoặc đang mở đúng khung chat đó;
 *  - tối đa CHAT_TOAST_MAX toast, vượt thì toast cũ nhất rời đi; mọi lần vào/rời đều có hiệu ứng thu gọn/nở (không giật);
 *  - "Tạm tắt 15 phút / 1 tiếng" ẩn hết toast, KHÔNG ảnh hưởng badge ở nút Tin nhắn trên topbar.
 */

export const CHAT_TOAST_MAX = 10
/** Khớp `--chat-toast-exit` trong chat.css (hiệu ứng thu gọn khi toast rời). */
export const CHAT_TOAST_EXIT_MS = 240

export const CHAT_MUTE_OPTIONS = [
  { label: '15 phút', ms: 15 * 60 * 1000 },
  { label: '1 tiếng', ms: 60 * 60 * 1000 },
] as const

/** `lastId` của hội thoại lúc người dùng bấm X (hoặc lúc mở trang) — toast chỉ hiện lại khi `lastId` lớn hơn. */
export type DismissedMap = Readonly<Record<string, number>>

export type ChatToastEntry = {
  conversation: ChatConversation
  /** Đang chạy hiệu ứng rời; chưa gỡ khỏi DOM. */
  leaving: boolean
}

/**
 * Hội thoại nào ĐÁNG có toast lúc này. Kết quả xếp cũ → mới (toast cũ nhất ở trên cùng), cắt còn `max` cái MỚI nhất.
 * Đang tạm tắt ⇒ rỗng.
 */
export function selectToastConversations(
  items: ReadonlyArray<ChatConversation>,
  options: { dismissed: DismissedMap; viewingConvId: string | null; muted: boolean; max?: number },
): ChatConversation[] {
  if (options.muted) return []
  const max = options.max ?? CHAT_TOAST_MAX
  const shown = items
    .filter(
      (item) =>
        item.unread > 0 &&
        item.convId !== options.viewingConvId &&
        item.lastId > (options.dismissed[item.convId] ?? 0),
    )
    .sort((a, b) => a.lastAt - b.lastAt || a.lastId - b.lastId)
  return shown.length > max ? shown.slice(shown.length - max) : shown
}

/**
 * Hòa danh sách đang vẽ (`prev`) với danh sách mong muốn (`desired`):
 *  - đã có ⇒ giữ NGUYÊN VỊ TRÍ, cập nhật nội dung (tin dồn không làm toast nhảy chỗ); đang rời mà quay lại ⇒ hồi sinh;
 *  - mới ⇒ thêm vào cuối (sát góc);
 *  - không còn trong `desired` ⇒ đánh dấu `leaving` để UI thu gọn rồi mới gỡ — không biến mất đột ngột.
 * Không có gì đổi ⇒ trả đúng `prev` (tránh render thừa).
 */
export function syncToastEntries(
  prev: ReadonlyArray<ChatToastEntry>,
  desired: ReadonlyArray<ChatConversation>,
): ChatToastEntry[] {
  const wanted = new Map(desired.map((conversation) => [conversation.convId, conversation]))
  let changed = false

  const next = prev.map((entry) => {
    const conversation = wanted.get(entry.conversation.convId)
    if (conversation) {
      wanted.delete(entry.conversation.convId)
      if (conversation === entry.conversation && !entry.leaving) return entry
      changed = true
      return { conversation, leaving: false }
    }
    if (entry.leaving) return entry
    changed = true
    return { ...entry, leaving: true }
  })

  for (const conversation of desired) {
    if (!wanted.has(conversation.convId)) continue
    changed = true
    next.push({ conversation, leaving: false })
  }
  return changed ? next : (prev as ChatToastEntry[])
}

/** Gỡ hẳn một toast — CHỈ khi nó vẫn đang `leaving` (nếu giữa chừng được hồi sinh thì giữ lại). */
export function removeLeavingEntry(prev: ReadonlyArray<ChatToastEntry>, convId: string): ChatToastEntry[] {
  const target = prev.find((entry) => entry.conversation.convId === convId)
  if (!target || !target.leaving) return prev as ChatToastEntry[]
  return prev.filter((entry) => entry !== target)
}

export function activeEntryCount(entries: ReadonlyArray<ChatToastEntry>) {
  return entries.reduce((n, entry) => (entry.leaving ? n : n + 1), 0)
}

/** Còn tạm tắt không (`mutedUntil` = mốc ms, null = không tắt). */
export function isMuted(mutedUntil: number | null, now: number) {
  return mutedUntil !== null && now < mutedUntil
}

/** Mốc "đến HH:mm" hiển thị ở nhãn đang tạm tắt. */
export function formatMuteUntil(ts: number) {
  const date = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
