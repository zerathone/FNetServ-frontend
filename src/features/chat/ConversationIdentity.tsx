import { Desktop, User } from '@phosphor-icons/react'
import type { ChatConversation } from '../../api/chat'
import { badgeText, conversationTag } from './chatModel'
import './chat.css'

/** Chấm đỏ số tin chưa đọc (cùng kiểu badge ở danh sách hội thoại); 0 ⇒ không vẽ. Dùng cả ngoài Chat Center. */
export function UnreadBadge({ count }: { count: number }) {
  const text = badgeText(count)
  if (!text) return null
  return (
    <span className="chat-unread-badge" aria-label={`${count} tin chưa đọc`}>
      {text}
    </span>
  )
}

/** Avatar tròn (máy = khách vãng lai, người = hội viên) + chấm xanh khi đang ngồi máy. */
export function ConversationAvatar({ conversation }: { conversation: ChatConversation }) {
  const Icon = conversation.kind === 'host' ? Desktop : User
  return (
    <span className={`chat-conv__avatar${conversation.online ? ' is-online' : ''}`} aria-hidden="true">
      <Icon size={20} weight="duotone" />
    </span>
  )
}

/** Huy hiệu VIỀN (outline) tên nhóm hội viên; không có nhóm ⇒ không vẽ gì. */
export function GroupBadge({ conversation }: { conversation: ChatConversation }) {
  if (!conversation.groupName) return null
  return (
    <span className="chat-conv__group" title={`Nhóm hội viên: ${conversation.groupName}`}>
      {conversation.groupName}
    </span>
  )
}

/**
 * Tiêu đề khung chat: avatar + tên + nhóm, dòng dưới là tên máy in nhạt (khách vãng lai: nhãn "Khách vãng lai";
 * hội viên offline: không có dòng phụ). Đặt trong <h2> của Drawer nên chỉ dùng thẻ inline.
 */
export function ConversationHeading({ conversation }: { conversation: ChatConversation }) {
  const sub = conversationTag(conversation)
  return (
    <span className="chat-who">
      <ConversationAvatar conversation={conversation} />
      <span className="chat-who__text">
        <span className="chat-who__line">
          <strong className="chat-who__name">{conversation.title}</strong>
          <GroupBadge conversation={conversation} />
        </span>
        {sub ? (
          <span className="chat-who__sub" title={sub}>
            {sub}
          </span>
        ) : null}
      </span>
    </span>
  )
}
