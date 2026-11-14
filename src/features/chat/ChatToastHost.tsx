import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BellSlash, UserCheck, X } from '@phosphor-icons/react'
import { CHAT_QUERY_KEY, isChatUnavailable, listChatConversations } from '../../api/chat'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { useWsStatusStore } from '../../store/wsStatus'
import { badgeText, CHAT_POLL_DISABLED_MS, CHAT_POLL_ENABLED_MS, conversationTag } from './chatModel'
import { useChatOpenStore } from './chatOpenStore'
import { ConversationAvatar } from './ConversationIdentity'
import {
  activeEntryCount,
  CHAT_MUTE_OPTIONS,
  CHAT_TOAST_EXIT_MS,
  formatMuteUntil,
  handlerLabel,
  isMuteActive,
  removeLeavingEntry,
  selectToastConversations,
  syncToastEntries,
  type ChatToastEntry,
} from './chatToastModel'
import { useChatToastStore } from './chatToastStore'
import './chat.css'

/** setTimeout tối đa ~24,8 ngày; mốc tạm tắt chỉ vài giờ nhưng chặn cho chắc. */
const MAX_TIMEOUT_MS = 2_000_000_000

/**
 * Nguồn toast: Server C11b hỗ trợ `filter:'awaiting'` (tin cuối là của khách — kể cả đã có người đọc). Server cũ chưa biết
 * bộ lọc đó ⇒ `filter invalid` ⇒ rơi về `unread` (hành vi trước C11). Ghi nhớ kết quả để khỏi hỏi hai lần mỗi lượt.
 */
let awaitingSupported: boolean | null = null
async function listToastConversations() {
  if (awaitingSupported !== false) {
    try {
      const page = await listChatConversations({ filter: 'awaiting', limit: 30 })
      awaitingSupported = true
      return page
    } catch (error) {
      if (!(error instanceof ApiError) || !error.message.startsWith('filter invalid')) throw error
      awaitingSupported = false
    }
  }
  return listChatConversations({ filter: 'unread', limit: 30 })
}

function ChatToastItem({
  entry,
  selfStaffId,
  onGone,
}: {
  entry: ChatToastEntry
  selfStaffId: number | null
  onGone: (convId: string) => void
}) {
  const dismiss = useChatToastStore((state) => state.dismiss)
  const openChat = useChatOpenStore((state) => state.open)
  const { conversation, leaving } = entry

  // Hiệu ứng rời xong mới gỡ khỏi DOM. Giữa chừng được hồi sinh (leaving = false) thì effect dọn timer.
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => onGone(conversation.convId), CHAT_TOAST_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, conversation.convId, onGone])

  const tag = conversationTag(conversation)
  const unread = badgeText(conversation.unread)
  // Nhân viên khác đã mở chat này (chưa trả lời) ⇒ ghi tên để thu ngân còn lại biết đã có người nhận.
  const handler = handlerLabel(conversation, selfStaffId)
  const hide = () => dismiss(conversation.convId, conversation.lastId)
  const open = () => {
    openChat(conversation)
    hide()
  }

  return (
    <div className={`chat-toast${leaving ? ' is-leaving' : ''}`}>
      <div className="chat-toast__clip">
        <div className="chat-toast__card">
          <button
            type="button"
            className="chat-toast__main"
            onClick={open}
            tabIndex={leaving ? -1 : 0}
            aria-label={`${conversation.title}: ${
              conversation.unread > 0 ? `${conversation.unread} tin chưa đọc` : 'chờ phản hồi'
            }${handler ? `, ${handler} đang xử lý` : ''}. Bấm để mở hội thoại`}
          >
            <span className="chat-toast__avatar">
              <ConversationAvatar conversation={conversation} />
              {unread ? (
                <span className="chat-unread-badge chat-toast__badge" aria-hidden="true">
                  {unread}
                </span>
              ) : null}
            </span>
            <span className="chat-toast__text">
              <span className="chat-toast__line">
                <strong className="chat-toast__name">{conversation.title}</strong>
                {tag ? <span className="chat-toast__tag">{tag}</span> : null}
              </span>
              <span className="chat-toast__msg">{conversation.lastText || 'Tin nhắn mới'}</span>
              {handler ? (
                <span className="chat-toast__handler">
                  <UserCheck size={13} weight="bold" aria-hidden="true" />
                  <span>{handler} đang xử lý</span>
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            className="chat-toast__close"
            onClick={hide}
            tabIndex={leaving ? -1 : 0}
            title="Ẩn thông báo này (hiện lại khi có tin mới)"
            aria-label={`Ẩn thông báo của ${conversation.title}`}
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Toast tin nhắn của khách ở GÓC DƯỚI PHẢI, kiểu thông báo màn hình khóa. Toast mới nằm sát góc, cũ đẩy dần lên trên.
 * Danh sách neo đáy nên toast ở trên cùng rời đi không làm các toast bên dưới nhúc nhích. Luật hiện/ẩn: chatToastModel.ts.
 */
export function ChatToastHost() {
  const token = useAuthStore((state) => state.token)
  const wsConnected = useWsStatusStore((state) => state.connected)
  const viewingConvId = useChatOpenStore((state) => state.viewingConvId)
  const sessionId = useAuthStore((state) => state.sessionId)
  const staffId = useAuthStore((state) => state.staffId)
  const { mutedUntil, mutedSessionId, dismissed, baselined, baseline, mute, unmute, resetSession } =
    useChatToastStore()
  // Tạm tắt chỉ tính trong ĐÚNG phiên đăng nhập đã bấm (đổi tài khoản / đăng xuất ⇒ hết hiệu lực ngay).
  const muted = mutedUntil !== null && sessionId !== null && mutedSessionId === sessionId

  // Danh sách chưa đọc. WS `chat.message`/`chat.read` invalidate CHAT_QUERY_KEY (ServerEventsProvider) nên tự làm tươi;
  // poll chỉ là dự phòng khi WS rớt. Cờ chat tắt / Server cũ ⇒ lỗi ⇒ không có toast nào.
  const query = useQuery({
    queryKey: [...CHAT_QUERY_KEY, 'conversations', 'toast-unread'],
    queryFn: listToastConversations,
    enabled: Boolean(token),
    retry: false,
    staleTime: 5_000,
    refetchInterval: (current) => {
      if (current.state.error && (isChatUnavailable(current.state.error) || current.state.data === undefined)) {
        return CHAT_POLL_DISABLED_MS
      }
      return wsConnected ? CHAT_POLL_ENABLED_MS : 15_000
    },
  })
  const items = query.data?.items

  // Đăng xuất ⇒ quên trạng thái phiên; lần tải đầu sau đăng nhập ⇒ chốt các tin đang chưa đọc là đã thấy.
  useEffect(() => {
    if (!token) resetSession()
  }, [token, resetSession])
  useEffect(() => {
    if (token && items && !baselined) baseline(items)
  }, [token, items, baselined, baseline])

  // Hết hạn tạm tắt, hoặc mốc này của phiên/tài khoản khác ⇒ dọn; còn hiệu lực ⇒ hẹn tự bật lại đúng giờ.
  useEffect(() => {
    if (mutedUntil === null) return
    if (!isMuteActive(mutedUntil, mutedSessionId, sessionId, Date.now())) {
      unmute()
      return
    }
    const timer = window.setTimeout(unmute, Math.min(mutedUntil - Date.now(), MAX_TIMEOUT_MS))
    return () => window.clearTimeout(timer)
  }, [mutedUntil, mutedSessionId, sessionId, unmute])

  const desired = useMemo(
    () =>
      baselined && items
        ? selectToastConversations(items, { dismissed, viewingConvId, muted, selfStaffId: staffId })
        : [],
    [baselined, items, dismissed, viewingConvId, muted, staffId],
  )

  const [entries, setEntries] = useState<ChatToastEntry[]>([])
  useEffect(() => {
    setEntries((prev) => syncToastEntries(prev, desired))
  }, [desired])
  const onGone = useMemo(() => (convId: string) => setEntries((prev) => removeLeavingEntry(prev, convId)), [])

  const hasActive = activeEntryCount(entries) > 0
  if (entries.length === 0 && !muted) return null

  return (
    <div className="chat-toast-host">
      {hasActive ? (
        <div className="chat-toast-tools" role="group" aria-label="Tạm tắt thông báo tin nhắn">
          {CHAT_MUTE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="chat-toast-tools__btn"
              onClick={() => sessionId && mute(option.ms, sessionId)}
              title={`Tạm ẩn toast tin nhắn trong ${option.label} (badge ở nút Tin nhắn vẫn hiện)`}
            >
              <BellSlash size={15} weight="bold" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chat-toast-list" role="log" aria-live="polite" aria-relevant="additions">
        {entries.map((entry) => (
          <ChatToastItem key={entry.conversation.convId} entry={entry} selfStaffId={staffId} onGone={onGone} />
        ))}
      </div>

      {muted && mutedUntil !== null ? (
        <div className="chat-toast-muted" role="status">
          <BellSlash size={15} weight="bold" aria-hidden="true" />
          <span>Toast tạm tắt đến {formatMuteUntil(mutedUntil)}</span>
          <button type="button" className="chat-toast-muted__btn" onClick={unmute}>
            Bật lại
          </button>
        </div>
      ) : null}
    </div>
  )
}
