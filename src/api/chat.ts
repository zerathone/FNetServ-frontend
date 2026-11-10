import { retryAfterSecOf } from '../features/chat/chatModel'
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
  /** Nhóm hội viên của tài khoản (chỉ hội thoại `account`; server cũ / khách vãng lai / nhóm trống ⇒ không có khoá). */
  groupName?: string
  /** Chỉ có ở `/chat/online-peers`: loại phiên đang ngồi máy (member / staff / anonym / admin / combo). */
  utype?: string
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

// ---- Phản ứng (tim / like / cười) + trả lời (task chat-C9; server: handoff/HANDOFF_chat_C7.md mục 4) ----
export type ChatReactionKind = 'heart' | 'thumb' | 'laugh'
/** `n` = tổng mọi người; `mine` = của tôi (❤️ 0–10; 👍/😂 0–1). Server CHỈ trả khoá có n > 0 (không trả tên ai thả). */
export type ChatReactionCount = { n: number; mine: number }
export type ChatReactions = Partial<Record<ChatReactionKind, ChatReactionCount>>
/** `all` + `count: 0` = xoá MỌI phản ứng của chính tôi lên tin đó. */
export type ChatReactEmoji = ChatReactionKind | 'all'

/** Khối trích dẫn của tin trả lời — ảnh chụp lúc gửi, do SERVER tự cắt (≤ 80 ký tự). `dir` 1 = thu ngân, 2 = khách. */
export type ChatReplyTo = { id: number; dir: 1 | 2; who: string; text: string }

export type ChatCaps = { react?: boolean; reply?: boolean }

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
  /** Server mới luôn có (object rỗng khi chưa ai thả); Server cũ không có khoá này. */
  reactions?: ChatReactions
}

export type ChatMessagePage = {
  items: ChatMessage[]
  hasMore: boolean
  staffRead: number
  /** Thiếu `caps` ⇒ Server cũ chưa có thả tim / trả lời ⇒ UI ẨN các nút đó. */
  caps?: ChatCaps
}

export type ChatSendResult = {
  id: number
  channel: 'v2' | 'legacy'
  delivered: boolean
  duplicate?: boolean
  replyTo?: ChatReplyTo
}

export type ChatReactResult = { reactions: ChatReactions; changed: boolean }

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

/** Máy ĐANG online chưa có hội thoại nào (nhắn tin mới). Mục cùng hình dạng với `ChatConversation` (unread 0, lastAt 0). */
export const listChatOnlinePeers = () =>
  apiPost<{ items: ChatConversation[]; total: number; indexReady: boolean }, Record<string, never>>(
    '/chat/online-peers',
    {},
  )

export const listChatMessages =(body: { convId: string; beforeId?: number; limit?: number }) =>
  apiPost<ChatMessagePage, typeof body>('/chat/messages', body)

export const sendChatMessage = (body: { convId: string; text: string; clientMsgId: string; replyToId?: number }) =>
  apiPost<ChatSendResult, typeof body>('/chat/send', body)

/** Gửi số phản ứng MONG MUỐN (trạng thái tuyệt đối) — gửi lại do retry không cộng đôi. */
export const reactToChatMessage = (body: { convId: string; targetId: number; emoji: ChatReactEmoji; count: number }) =>
  apiPost<ChatReactResult, typeof body>('/chat/react', body)

/** `retryAfterSec` của `BURST_LOCKED` / `RATE_LIMITED` (server nhét ở `data`). `null` = lỗi khác hoặc thiếu số. */
export function chatRetryAfterSec(error: unknown): number | null {
  return error instanceof ApiError ? retryAfterSecOf(error.message, error.details) : null
}

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
