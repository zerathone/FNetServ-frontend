import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CaretDown, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { CHAT_QUERY_KEY, isChatUnavailable, listChatOnlinePeers, type ChatConversation } from '../../api/chat'
import { Button, StateView } from '../../design-system/components'
import { conversationMatches, describeChatError, peerSubtitle } from './chatModel'
import { ConversationAvatar, GroupBadge } from './ConversationIdentity'

/** Chỉ hiện ô lọc khi danh sách đủ dài để cần lọc. */
const FILTER_MIN_ITEMS = 8

type Props = {
  /** Chọn một máy ⇒ cha mở khung chat của hội thoại đó (chưa có tin nào cũng được: gửi tin đầu sẽ tạo hội thoại). */
  onPick: (conversation: ChatConversation) => void
}

/**
 * Nút "+ nhắn tin ▾" ở header: liệt kê các máy ĐANG online (hội viên / khách vãng lai / combo …) CHƯA có trong danh
 * sách hội thoại để mở thread mới. Dữ liệu tải mỗi lần mở menu (máy online thay đổi liên tục).
 */
export function NewChatMenu({ onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLSpanElement>(null)

  const query = useQuery({
    queryKey: [...CHAT_QUERY_KEY, 'online-peers'],
    queryFn: listChatOnlinePeers,
    enabled: open,
    staleTime: 0,
    retry: false,
  })

  // Bấm ra ngoài thì đóng. Popover vẽ bằng `position: absolute` trong header nên vẫn nằm trong `rootRef`.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const items = query.data?.items
  const shown = useMemo(
    () => (items ?? []).filter((peer) => conversationMatches(peer, filter, 'any')),
    [items, filter],
  )

  const pick = (peer: ChatConversation) => {
    setOpen(false)
    setFilter('')
    onPick(peer)
  }

  return (
    <span ref={rootRef} className="chat-new">
      <Button
        type="button"
        variant="secondary"
        className="chat-new__trigger"
        icon={<Plus size={16} weight="bold" aria-hidden="true" />}
        title="Soạn tin nhắn mới cho máy đang online"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Soạn tin mới</span>
        <CaretDown size={12} weight="bold" aria-hidden="true" />
      </Button>

      {open ? (
        <div className="chat-new__panel" role="listbox" aria-label="Máy đang online chưa có hội thoại">
          <p className="chat-new__hint">Máy đang online chưa có tin nhắn</p>
          {items && items.length >= FILTER_MIN_ITEMS ? (
            <div className="ds-search-input chat-new__filter">
              <MagnifyingGlass className="ds-search-input__icon" size={16} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={filter}
                placeholder="Lọc theo tên hội viên hoặc máy"
                aria-label="Lọc máy đang online"
                autoFocus
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          ) : null}
          {query.isLoading ? <StateView title="Đang tải…" /> : null}
          {query.isError ? (
            <StateView
              title="Không tải được danh sách"
              description={
                isChatUnavailable(query.error)
                  ? 'Máy chủ bản này chưa hỗ trợ nhắn tin mới.'
                  : describeChatError((query.error as Error).message)
              }
              action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
            />
          ) : null}
          {items && !items.length ? (
            <StateView
              title="Không có máy nào"
              description="Mọi máy đang online đều đã có hội thoại ở danh sách bên dưới."
            />
          ) : null}
          {items && items.length > 0 && !shown.length ? <StateView title="Không có máy khớp" /> : null}
          <ul className="chat-new__items">
            {shown.map((peer) => {
              const sub = peerSubtitle(peer)
              return (
                <li key={peer.convId}>
                  <button type="button" role="option" aria-selected={false} className="chat-peer" onClick={() => pick(peer)}>
                    <ConversationAvatar conversation={peer} />
                    <span className="chat-peer__text">
                      <span className="chat-peer__line">
                        <strong className="chat-peer__name">{peer.title}</strong>
                        <GroupBadge conversation={peer} />
                      </span>
                      {sub ? <span className="chat-peer__sub">{sub}</span> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </span>
  )
}
