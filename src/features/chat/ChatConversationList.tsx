import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Desktop, MagnifyingGlass, User, X } from '@phosphor-icons/react'
import {
  CHAT_QUERY_KEY,
  listChatConversations,
  type ChatConversation,
  type ChatConversationFilter,
} from '../../api/chat'
import { Button, StateView } from '../../design-system/components'
import {
  badgeText,
  conversationMatches,
  conversationSubtitle,
  describeChatError,
  formatChatTime,
  isoOf,
} from './chatModel'

const PAGE_SIZE = 100

const FILTERS: ReadonlyArray<{ id: ChatConversationFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'unread', label: 'Chưa đọc' },
  { id: 'accounts', label: 'Tài khoản' },
  { id: 'hosts', label: 'Khách vãng lai' },
]

type Props = {
  onOpen: (conversation: ChatConversation) => void
}

export function ChatConversationList({ onOpen }: Props) {
  const [filter, setFilter] = useState<ChatConversationFilter>('all')
  const [search, setSearch] = useState('')

  // Phân trang theo `offset` (server giới hạn 100/trang). Refetch (WS) tải lại ĐỦ các trang đang mở.
  const query = useInfiniteQuery({
    queryKey: [...CHAT_QUERY_KEY, 'conversations', filter],
    queryFn: ({ pageParam }) => listChatConversations({ filter, offset: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return last.items.length > 0 && loaded < last.total ? loaded : undefined
    },
    retry: false,
    staleTime: 5_000,
  })

  const loadedItems = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data?.pages])
  const total = query.data?.pages[0]?.total ?? 0
  const indexReady = query.data?.pages[0]?.indexReady ?? true
  const items = useMemo(
    () => loadedItems.filter((conversation) => conversationMatches(conversation, search)),
    [loadedItems, search],
  )
  const searching = search.trim() !== ''

  return (
    <div className="chat-list">
      <div className="chat-list__toolbar">
        <div className="chat-tabs" role="tablist" aria-label="Lọc hội thoại">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? 'is-active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ds-search-input">
          <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Tìm tài khoản, máy, nội dung"
            aria-label="Tìm hội thoại"
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              className="ds-search-input__clear"
              aria-label="Xóa tìm kiếm"
              onClick={() => setSearch('')}
            >
              <X size={18} weight="fill" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {query.data && !indexReady ? (
        <p className="chat-list__note">Máy chủ đang dựng chỉ mục hội thoại — danh sách có thể chưa đủ.</p>
      ) : null}
      {query.isLoading ? <StateView title="Đang tải hội thoại…" /> : null}
      {query.isError && !query.data ? (
        <StateView
          title="Không tải được hội thoại"
          description={describeChatError((query.error as Error).message)}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : null}
      {query.data && !items.length ? (
        <StateView
          title={searching ? 'Không có hội thoại khớp' : filter === 'unread' ? 'Không có tin chưa đọc' : 'Chưa có hội thoại'}
          description={
            searching
              ? `Không có hội thoại nào khớp "${search.trim()}" trong ${loadedItems.length}/${total} hội thoại đã tải${
                  query.hasNextPage ? ' — bấm "Tải thêm" để tìm tiếp.' : '.'
                }`
              : 'Hội thoại xuất hiện khi khách nhắn tin hoặc khi nhân viên nhắn cho khách.'
          }
        />
      ) : null}

      <ul className="chat-list__items">
        {items.map((conversation) => {
          const badge = badgeText(conversation.unread)
          const Icon = conversation.kind === 'host' ? Desktop : User
          return (
            <li key={conversation.convId}>
              <button
                type="button"
                className={`chat-conv${conversation.unread > 0 ? ' is-unread' : ''}`}
                onClick={() => onOpen(conversation)}
              >
                <span className={`chat-conv__avatar${conversation.online ? ' is-online' : ''}`} aria-hidden="true">
                  <Icon size={20} weight="duotone" />
                </span>
                <span className="chat-conv__main">
                  <span className="chat-conv__top">
                    <strong className="chat-conv__title">{conversation.title}</strong>
                    {conversation.lastAt > 0 ? (
                      <time className="chat-conv__time" dateTime={isoOf(conversation.lastAt)}>
                        {formatChatTime(conversation.lastAt)}
                      </time>
                    ) : null}
                  </span>
                  <span className="chat-conv__sub">{conversationSubtitle(conversation)}</span>
                  <span className="chat-conv__last">{conversation.lastText || 'Chưa có tin nhắn'}</span>
                </span>
                {badge ? (
                  <span className="chat-conv__badge" aria-label={`${conversation.unread} tin chưa đọc`}>
                    {badge}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      {query.hasNextPage ? (
        <div className="chat-list__more">
          <Button type="button" variant="ghost" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Tải thêm ({loadedItems.length}/{total})
          </Button>
        </div>
      ) : null}
    </div>
  )
}
