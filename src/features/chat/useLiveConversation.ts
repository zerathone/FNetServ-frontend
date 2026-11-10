import { useQuery } from '@tanstack/react-query'
import { CHAT_QUERY_KEY, listChatConversations, type ChatConversation } from '../../api/chat'

/**
 * Trạng thái SỐNG của hội thoại (đang ngồi máy nào / online / nhóm) — `conversation` truyền vào chỉ là ảnh chụp
 * lúc bấm. Server chưa có lọc theo convId nên hỏi theo `q` rồi chọn đúng mục.
 * Dùng chung queryKey cho header khung chat và ChatThread ⇒ React Query gộp thành MỘT request.
 */
export function useLiveConversation(conversation: ChatConversation | null): ChatConversation | null {
  const convId = conversation?.convId ?? ''
  const query = useQuery({
    queryKey: [...CHAT_QUERY_KEY, 'conversations', 'one', convId],
    queryFn: () => listChatConversations({ q: convId, limit: 20 }),
    enabled: convId !== '',
    retry: false,
    staleTime: 5_000,
  })
  return query.data?.items.find((item) => item.convId === convId) ?? conversation
}
