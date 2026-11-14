import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowsClockwise, ChatCircleDots } from '@phosphor-icons/react'
import { CHAT_QUERY_KEY, type ChatConversation } from '../../api/chat'
import { Button, Drawer } from '../../design-system/components'
import { badgeText, otherUnreadCount } from './chatModel'
import { ChatConversationList } from './ChatConversationList'
import { ChatThread } from './ChatThread'
import { ConversationHeading } from './ConversationIdentity'
import { NewChatMenu } from './NewChatMenu'
import { useChatOpenStore } from './chatOpenStore'
import { useLiveConversation } from './useLiveConversation'
import { useChatPulse } from './useChatPulse'
import { useChatSummary } from './useChatSummary'
import '../notifications/notifications.css'
import './chat.css'

/**
 * Nút bong bóng chat kế nút chuông ở topbar + Drawer bên phải (danh sách hội thoại → luồng chat).
 * Kênh chat v2 tắt / Server.exe bản cũ ⇒ KHÔNG render gì (DESIGN_CHAT_MESSENGER mục 2.1, 5).
 */
export function ChatCenter() {
  const queryClient = useQueryClient()
  const { available, unreadTotal } = useChatSummary()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ChatConversation | null>(null)
  // Nút quan trọng: tin mới tới (số chưa đọc tăng) ⇒ nhịp tim 10 giây. Đang mở khung chat thì không chớp.
  const pulsing = useChatPulse(available ? unreadTotal : null)
  // Header khung chat: avatar + nhóm + tên máy lấy từ trạng thái SỐNG (ảnh chụp `selected` có thể đã cũ).
  const liveSelected = useLiveConversation(selected)

  // Nơi khác trong app (nút Nhắn tin ở drawer máy trạm) xin mở thẳng vào một thread.
  const request = useChatOpenStore((state) => state.request)
  const clearRequest = useChatOpenStore((state) => state.clear)
  useEffect(() => {
    if (!request || !available) return
    setOpen(true)
    setSelected(request.conversation)
    clearRequest()
  }, [request, available, clearRequest])

  // Báo cho toast tin mới biết hội thoại đang xem (đang đọc thì không toast trùng). Rời ChatCenter ⇒ gỡ.
  const setViewing = useChatOpenStore((state) => state.setViewing)
  const viewingConvId = open && selected ? selected.convId : null
  useEffect(() => {
    setViewing(viewingConvId)
    return () => setViewing(null)
  }, [viewingConvId, setViewing])

  // Cờ bị tắt khi Drawer đang mở: đóng + bỏ hội thoại đang chọn, kẻo bật lại cờ thì Drawer tự bật lên.
  useEffect(() => {
    if (!available) {
      setOpen(false)
      setSelected(null)
    }
  }, [available])

  if (!available) return null

  const badge = badgeText(unreadTotal)
  // Đang trong một thread: nút "<" mang số tin chưa đọc của các tài khoản KHÁC (thread đang xem đã trừ ra).
  const otherUnread = selected ? otherUnreadCount(unreadTotal, liveSelected?.unread ?? 0) : 0
  const otherBadge = badgeText(otherUnread)
  const close = () => {
    setOpen(false)
    setSelected(null)
  }

  return (
    <>
      <button
        type="button"
        className={`notification-trigger chat-trigger${unreadTotal ? ' has-unread' : ''}${
          pulsing && !open ? ' is-pulsing' : ''
        }`}
        aria-label={`Tin nhắn${unreadTotal ? `, ${unreadTotal} tin chưa đọc` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ChatCircleDots size={21} weight={unreadTotal ? 'fill' : 'regular'} aria-hidden="true" />
        <span className="chat-trigger__label">Tin nhắn</span>
        {badge ? (
          <span className="notification-trigger__count" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        title={selected && liveSelected ? <ConversationHeading conversation={liveSelected} /> : 'Tin nhắn'}
        className="chat-drawer"
        onClose={close}
        headerLeading={
          selected ? (
            <span className="chat-back">
              <Button
                type="button"
                variant="secondary"
                className="ds-icon-button"
                icon={<ArrowLeft size={18} weight="bold" aria-hidden="true" />}
                title={
                  otherUnread ? `Về danh sách hội thoại (${otherUnread} tin chưa đọc ở tài khoản khác)` : 'Về danh sách hội thoại'
                }
                aria-label={
                  otherUnread ? `Về danh sách hội thoại, ${otherUnread} tin chưa đọc ở tài khoản khác` : 'Về danh sách hội thoại'
                }
                onClick={() => setSelected(null)}
              />
              {otherBadge ? (
                <span className="chat-unread-badge chat-back__badge" aria-hidden="true">
                  {otherBadge}
                </span>
              ) : null}
            </span>
          ) : null
        }
        headerActions={
          <>
            {selected ? null : <NewChatMenu onPick={setSelected} />}
            <Button
              type="button"
              variant="secondary"
              className="ds-icon-button"
              icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
              title="Làm mới"
              aria-label="Làm mới"
              onClick={() => void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })}
            />
          </>
        }
      >
        {selected ? (
          <ChatThread key={selected.convId} conversation={selected} />
        ) : (
          <ChatConversationList onOpen={setSelected} />
        )}
      </Drawer>
    </>
  )
}
