import { useQuery } from '@tanstack/react-query'
import {
  CHAT_SUMMARY_QUERY_KEY,
  isChatUnavailable,
  listChatConversations,
} from '../../api/chat'
import { useAuthStore } from '../../store/auth'
import { useWsStatusStore } from '../../store/wsStatus'
import { CHAT_POLL_DISABLED_MS, CHAT_POLL_ENABLED_MS } from './chatModel'

/**
 * Tổng chưa đọc cho badge nút chat ở topbar + cờ "kênh chat có dùng được không".
 * `available = false` khi cờ tắt (`chat_v2_disabled`) hoặc Server.exe là bản cũ chưa có `/chat/*`
 * (404) ⇒ nút chat KHÔNG hiện (khách dùng đường cũ không thấy gì khác).
 * Realtime: WS `chat.message`/`chat.read` invalidate `CHAT_QUERY_KEY` (ServerEventsProvider);
 * poll chỉ là dự phòng khi WS rớt.
 */
export function useChatSummary() {
  const token = useAuthStore((state) => state.token)
  const wsConnected = useWsStatusStore((state) => state.connected)

  const query = useQuery({
    queryKey: CHAT_SUMMARY_QUERY_KEY,
    queryFn: () => listChatConversations({ limit: 1 }),
    enabled: Boolean(token),
    retry: false,
    staleTime: 5_000,
    refetchInterval: (current) => {
      // Lỗi mà chưa từng có dữ liệu (cờ tắt, server cũ, lỗi lạ như preflight CORS ném TypeError) ⇒ hỏi thưa.
      if (current.state.error && (isChatUnavailable(current.state.error) || current.state.data === undefined)) {
        return CHAT_POLL_DISABLED_MS
      }
      return wsConnected ? CHAT_POLL_ENABLED_MS : 15_000
    },
  })

  return {
    /** Chỉ coi là dùng được khi đã có dữ liệu thật từ server (lỗi mạng thoáng qua không làm nút nhấp nháy: data cũ vẫn còn). */
    available: query.data !== undefined && !(query.error && isChatUnavailable(query.error)),
    unreadTotal: query.data?.unreadTotal ?? 0,
  }
}
