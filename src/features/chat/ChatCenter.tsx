import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowsClockwise, ChatCircleDots } from '@phosphor-icons/react'
import { CHAT_QUERY_KEY, type ChatConversation } from '../../api/chat'
import { Button, Drawer } from '../../design-system/components'
import { badgeText } from './chatModel'
import { ChatConversationList } from './ChatConversationList'
import { ChatThread } from './ChatThread'
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

  // Cờ bị tắt khi Drawer đang mở: đóng + bỏ hội thoại đang chọn, kẻo bật lại cờ thì Drawer tự bật lên.
  useEffect(() => {
    if (!available) {
      setOpen(false)
      setSelected(null)
    }
  }, [available])

  if (!available) return null

  const badge = badgeText(unreadTotal)
  const close = () => {
    setOpen(false)
    setSelected(null)
  }

  return (
    <>
      <button
        type="button"
        className="notification-trigger chat-trigger"
        aria-label={`Tin nhắn${unreadTotal ? `, ${unreadTotal} tin chưa đọc` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ChatCircleDots size={21} weight={unreadTotal ? 'fill' : 'regular'} aria-hidden="true" />
        {badge ? (
          <span className="notification-trigger__count" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        title={selected ? selected.title : 'Tin nhắn'}
        className="chat-drawer"
        onClose={close}
        headerActions={
          <>
            {selected ? (
              <Button
                type="button"
                variant="ghost"
                icon={<ArrowLeft size={18} weight="bold" aria-hidden="true" />}
                onClick={() => setSelected(null)}
              >
                Hội thoại
              </Button>
            ) : null}
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
