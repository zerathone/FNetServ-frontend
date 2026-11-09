import { ApiError, apiGet, apiPost, apiPut } from './client'

// Kênh chat Messenger mới (task chat-v2 / C3) — hợp đồng server: handoff/HANDOFF_chat_C2.md "Hợp đồng API".
// Cờ tắt (hoặc Server.exe bản cũ chưa có route) ⇒ server trả `chat_v2_disabled` / 404 ⇒ UI ẩn nút chat,
// KHÔNG báo lỗi (90% khách dùng đường cũ).

export type ChatConvKind = 'account' | 'host'

export type ChatConversation = {
  convId: string
  kind: ChatConvKind
  title: string
  uid?: number
  /** Máy đang ngồi (tài khoản) hoặc chính máy (khách vãng lai online); không có = offline. */
  hostName?: string
  online: boolean
  lastText: string
  lastAt: number
  lastId: number
  unread: number
}

export type ChatConversationPage = {
  items: ChatConversation[]
  total: number
  unreadTotal: number
  indexReady: boolean
}

export type ChatCardKind = 'cash_request' | 'online_request' | 'order_check'
export type ChatMessageKind = 'chat' | ChatCardKind

export type ChatMessage = {
  id: number
  ts: number
  /** 1 = thu ngân → máy, 2 = máy → thu ngân. */
  dir: 1 | 2
  /** 1 = kênh cũ, 2 = v2. */
  ch: number
  /** 1 thu ngân MFC · 2 nhân viên fnet-web · 3 máy trạm (TCP cũ) · 4 máy trạm (REST v2). */
  src: 1 | 2 | 3 | 4
  host: string
  kind: ChatMessageKind
  meta: Record<string, unknown> | null
  staffId: number
  staffName: string
  user: string
  uid: number
  utype: string
  sess: number
  text: string
  truncated?: boolean
}

export type ChatMessagePage = {
  items: ChatMessage[]
  hasMore: boolean
  staffRead: number
}

export type ChatSendResult = {
  id: number
  channel: 'v2' | 'legacy'
  delivered: boolean
  duplicate?: boolean
}

export type ChatConversationFilter = 'all' | 'accounts' | 'hosts' | 'unread'

export const CHAT_QUERY_KEY = ['chat'] as const
export const CHAT_SUMMARY_QUERY_KEY = ['chat', 'summary'] as const

export const CHAT_MAX_LENGTH = 1000

/**
 * Server báo cờ chat v2 đang tắt, hoặc là bản cũ chưa có `/chat/*` — cả hai đều = "không dùng chat v2".
 * Route lạ ở `HttpServ.cpp` không có handler (`nullptr`) nên tuỳ tầng Poco có thể ra 404 **hoặc 501** ⇒ nhận cả hai;
 * chưa kiểm bằng `curl -i -X POST http://127.0.0.1:18099/chat/conversations` trên Server.exe bản cũ (test-card W16).
 */
export function isChatUnavailable(error: unknown) {
  if (!(error instanceof ApiError)) return false
  return error.message === 'chat_v2_disabled' || error.httpStatus === 404 || error.httpStatus === 501
}

export const listChatConversations = (body: {
  filter?: ChatConversationFilter
  q?: string
  offset?: number
  limit?: number
}) => apiPost<ChatConversationPage, typeof body>('/chat/conversations', body)

export const listChatMessages = (body: { convId: string; beforeId?: number; limit?: number }) =>
  apiPost<ChatMessagePage, typeof body>('/chat/messages', body)

export const sendChatMessage = (body: { convId: string; text: string; clientMsgId: string }) =>
  apiPost<ChatSendResult, typeof body>('/chat/send', body)

export const markChatRead = (body: { convId: string; upToId: number }) =>
  apiPost<{ staffRead: number; unread: number }, typeof body>('/chat/read', body)

// ---- Thiết lập (admin) -----------------------------------------------------------------------

export type ChatSettings = {
  enabled: boolean
  /** 0 = không tự xoá; 1–365 = số ngày giữ. */
  retentionDays: number
  /** Rỗng = thư mục mặc định `<thư mục Server>\chat_v2\`. */
  storagePath: string
  effectivePath: string
  /** Chỉ có ở kết quả PUT khi đổi thư mục: dữ liệu cũ KHÔNG được chuyển. */
  warning?: string
}

export const getChatSettings = () => apiGet<ChatSettings>('/settings/chat')
export const updateChatSettings = (body: Partial<Pick<ChatSettings, 'enabled' | 'retentionDays' | 'storagePath'>>) =>
  apiPut<ChatSettings, typeof body>('/settings/chat', body)
