import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CurrencyCircleDollar, QrCode, Receipt } from '@phosphor-icons/react'
import {
  CHAT_QUERY_KEY,
  listChatConversations,
  listChatMessages,
  markChatRead,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
} from '../../api/chat'
import { Button, InlineAlert, StateView } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { useWsStatusStore } from '../../store/wsStatus'
import { formatVnd } from '../orders/orderPayModel'
import { ChatComposer } from './ChatComposer'
import {
  buildTimeline,
  cardOf,
  describeChatError,
  formatChatTime,
  groupTimeline,
  isoOf,
  latestInboundId,
  mergeMessages,
  newClientMsgId,
  type CardView,
} from './chatModel'

const PAGE_SIZE = 50
const NOT_DELIVERED_NOTICE = {
  host: 'Tin đã lưu nhưng khách đã rời máy nên chưa nhận được.',
  account: 'Tin đã lưu nhưng tài khoản đang ngoại tuyến — hội viên thấy khi đăng nhập ở máy bất kỳ.',
} as const
const STICK_TO_BOTTOM_PX = 96

const CARD_ICONS = {
  cash_request: CurrencyCircleDollar,
  online_request: QrCode,
  order_check: Receipt,
} as const

function CommandCard({ message, card }: { message: ChatMessage; card: CardView }) {
  const Icon = CARD_ICONS[card.kind]
  return (
    <div className={`chat-card chat-card--${card.kind}`}>
      <div className="chat-card__head">
        <Icon size={20} weight="duotone" aria-hidden="true" />
        <strong>{card.title}</strong>
      </div>
      <dl className="chat-card__body">
        {card.amount !== null ? (
          <div>
            <dt>Số tiền</dt>
            <dd>{formatVnd(card.amount)}</dd>
          </div>
        ) : null}
        {card.orderId ? (
          <div>
            <dt>Mã đơn</dt>
            <dd>{card.orderId}</dd>
          </div>
        ) : null}
        <div>
          <dt>Hội viên</dt>
          <dd>{message.user || '—'}</dd>
        </div>
        <div>
          <dt>Máy</dt>
          <dd>{message.host || '—'}</dd>
        </div>
      </dl>
      <time className="chat-card__time" dateTime={isoOf(message.ts)}>
        {formatChatTime(message.ts)}
      </time>
    </div>
  )
}

type Props = {
  conversation: ChatConversation
}

export function ChatThread({ conversation }: Props) {
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  const convId = conversation.convId

  // Trang mới nhất luôn do React Query giữ tươi (WS invalidate); các trang cũ tải tay ghép phía trước.
  const latestQuery = useQuery({
    queryKey: [...CHAT_QUERY_KEY, 'messages', convId],
    queryFn: () => listChatMessages({ convId, limit: PAGE_SIZE }),
    retry: false,
    staleTime: 5_000,
  })
  // `seen` TÍCH LUỸ mọi tin đã thấy (trang mới nhất qua các lần refetch + các trang cũ tải tay). Không được
  // chỉ ghép "trang cũ + trang mới nhất": trang mới nhất là cửa sổ 50 tin trượt theo thời gian, tin rơi khỏi
  // cửa sổ mà chưa nằm trong trang cũ sẽ biến mất (kể cả thẻ nạp tiền).
  const [seen, setSeen] = useState<ChatMessage[]>([])
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState('')
  const [notice, setNotice] = useState('')
  const latestItems = latestQuery.data?.items
  useEffect(() => {
    if (latestItems) setSeen((current) => mergeMessages(current, latestItems))
  }, [latestItems])

  // Ghép cả `latestItems` (không chỉ `seen`) để tin vừa về hiện ngay, không trễ 1 nhịp effect.
  const messages = useMemo(() => mergeMessages(seen, latestItems ?? []), [seen, latestItems])
  // Chưa tải trang cũ nào ⇒ theo trang mới nhất; đã tải ⇒ theo trang cũ nhất vừa tải.
  const hasMore = olderHasMore ?? latestQuery.data?.hasMore ?? false

  // Trạng thái SỐNG của hội thoại (đang ngồi máy nào / online) — `conversation` truyền vào chỉ là ảnh chụp
  // lúc bấm. Server chưa có lọc theo convId nên hỏi theo `q` rồi chọn đúng mục.
  const liveQuery = useQuery({
    queryKey: [...CHAT_QUERY_KEY, 'conversations', 'one', convId],
    queryFn: () => listChatConversations({ q: convId, limit: 20 }),
    retry: false,
    staleTime: 5_000,
  })
  const live = liveQuery.data?.items.find((item) => item.convId === convId) ?? conversation

  // Mốc "đã đọc" để vẽ vạch "Tin mới" — CHỐT lúc mở hội thoại, không đuổi theo con trỏ vừa đánh dấu
  // (nếu không vạch biến mất ngay khi mở, khách đã gửi gì không biết).
  const dividerReadRef = useRef<number | null>(null)
  if (dividerReadRef.current === null && latestQuery.data) {
    dividerReadRef.current = latestQuery.data.staffRead
  }
  const timeline = useMemo(
    () => buildTimeline(messages, dividerReadRef.current ?? latestQuery.data?.staffRead ?? 0),
    [messages, latestQuery.data?.staffRead],
  )

  const display = useMemo(() => groupTimeline(timeline, staffId), [timeline, staffId])

  // ---- Đánh dấu đã đọc khi đang xem thật (tab hiện) -------------------------------------------
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  const readMutation = useMutation({
    mutationFn: (upToId: number) => markChatRead({ convId, upToId }),
    // Lỗi (mất mạng, read_failed): nhả mốc đã đánh dấu để lần đổi state kế tiếp thử lại — nếu không badge đỏ kẹt.
    onError: () => {
      markedUpToRef.current = 0
    },
    // Thành công: server phát WS `chat.read` ⇒ ServerEventsProvider đã invalidate; chỉ tự invalidate khi WS rớt.
    onSuccess: () => {
      if (!useWsStatusStore.getState().connected) void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })
    },
  })
  const markedUpToRef = useRef(0)
  const inboundId = latestInboundId(messages)
  const staffRead = latestQuery.data?.staffRead ?? 0
  useEffect(() => {
    if (!visible || !latestQuery.data) return
    if (inboundId <= staffRead || inboundId <= markedUpToRef.current) return
    markedUpToRef.current = inboundId
    readMutation.mutate(inboundId)
    // readMutation.mutate ổn định; chỉ chạy lại khi có tin khách mới hơn mốc đã đánh dấu.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, inboundId, staffRead, latestQuery.data])

  // ---- Cuộn: mở = xuống đáy; tin mới = xuống đáy nếu đang ở gần đáy; tải cũ = giữ vị trí ----------
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const prevHeightRef = useRef<number | null>(null)
  const lastMessageId = messages.length ? messages[messages.length - 1].id : 0

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prevHeightRef.current !== null) {
      // Vừa chèn trang cũ phía trên: bù đúng phần cao thêm để màn hình không nhảy.
      el.scrollTop += el.scrollHeight - prevHeightRef.current
      prevHeightRef.current = null
      return
    }
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [lastMessageId, messages.length])

  const sendMutation = useMutation({
    mutationFn: (vars: { text: string; clientMsgId: string }) =>
      sendChatMessage({ convId, text: vars.text, clientMsgId: vars.clientMsgId }),
  })
  // Giữ `clientMsgId` cho tới khi gửi XONG: gửi lại sau lỗi mạng cùng 1 id ⇒ server chống trùng.
  const pendingIdRef = useRef<{ text: string; id: string } | null>(null)

  const handleSend = async (text: string) => {
    const pending =
      pendingIdRef.current && pendingIdRef.current.text === text
        ? pendingIdRef.current
        : { text, id: newClientMsgId() }
    pendingIdRef.current = pending
    let result
    try {
      result = await sendMutation.mutateAsync({ text, clientMsgId: pending.id })
    } catch (error) {
      throw new Error(describeChatError(error instanceof Error ? error.message : ''))
    }
    pendingIdRef.current = null
    // Server đã lưu nhưng không có máy nào nhận (khách vừa rời máy / tài khoản offline) — nói rõ, đừng
    // để bong bóng trông như đã tới tay khách.
    setNotice(result.delivered ? '' : NOT_DELIVERED_NOTICE[live.kind])
    stickRef.current = true
    await queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })
  }

  const loadOlder = async () => {
    if (loadingOlder || !messages.length) return
    const el = scrollRef.current
    setLoadingOlder(true)
    setOlderError('')
    try {
      const page = await listChatMessages({ convId, beforeId: messages[0].id, limit: PAGE_SIZE })
      // Chỉ bù cuộn khi thật sự chèn thêm tin phía trên (trang toàn tin trùng thì layout không đổi).
      prevHeightRef.current = el && page.items.some((item) => item.id < messages[0].id) ? el.scrollHeight : null
      setSeen((current) => mergeMessages(current, page.items))
      setOlderHasMore(page.hasMore)
    } catch (error) {
      setOlderError(describeChatError(error instanceof Error ? error.message : ''))
    } finally {
      setLoadingOlder(false)
    }
  }

  const hint = notice
    ? notice
    : live.kind === 'host'
      ? live.hostName
        ? undefined
        : 'Máy đang trống — tin chỉ lưu lại cho thu ngân xem, khách không nhận được.'
      : live.hostName
        ? undefined
        : 'Tài khoản ngoại tuyến — tin được lưu, hội viên thấy khi đăng nhập ở máy bất kỳ.'

  return (
    <div className="chat-thread">
      <div
        ref={scrollRef}
        className="chat-thread__scroll"
        onScroll={(event) => {
          const el = event.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX
        }}
      >
        {latestQuery.isLoading ? <StateView title="Đang tải tin nhắn…" /> : null}
        {latestQuery.isError && !latestQuery.data ? (
          <StateView
            title="Không tải được tin nhắn"
            description={describeChatError((latestQuery.error as Error).message)}
            action={<Button onClick={() => void latestQuery.refetch()}>Thử lại</Button>}
          />
        ) : null}
        {hasMore ? (
          <div className="chat-thread__older">
            <Button type="button" variant="ghost" loading={loadingOlder} onClick={() => void loadOlder()}>
              Tải tin cũ hơn
            </Button>
          </div>
        ) : null}
        {olderError ? <InlineAlert tone="danger">{olderError}</InlineAlert> : null}
        {latestQuery.data && !messages.length ? (
          <StateView title="Chưa có tin nhắn" description="Gõ tin đầu tiên ở ô bên dưới." />
        ) : null}

        <ol className="chat-thread__list">
          {display.map((entry) => {
            if (entry.type === 'session') {
              return (
                <li key={entry.key} className="chat-divider chat-divider--session" role="separator">
                  <span>{entry.label}</span>
                </li>
              )
            }
            if (entry.type === 'unread') {
              return (
                <li key={entry.key} className="chat-divider chat-divider--unread" role="separator">
                  <span>Tin mới</span>
                </li>
              )
            }
            if (entry.type === 'card') {
              const card = cardOf(entry.message)
              return card ? (
                <li key={entry.key} className="chat-row chat-row--left">
                  <CommandCard message={entry.message} card={card} />
                </li>
              ) : null
            }
            // Nhóm tin gần nhau của cùng một người = 1 bong bóng nhiều dòng; giờ ghi theo tin cuối,
            // rê chuột lên từng dòng xem giờ riêng.
            const lastMessage = entry.messages[entry.messages.length - 1]
            return (
              <li
                key={entry.key}
                className={`chat-row ${entry.own ? 'chat-row--right' : 'chat-row--left'}${
                  entry.continued ? ' chat-row--continued' : ''
                }`}
              >
                <div className={`chat-bubble${entry.own ? ' chat-bubble--own' : ''}`}>
                  {/* Tên người chat chỉ ở bong bóng ĐẦU của chuỗi liền nhau; các bong bóng kế tiếp chỉ có nội dung. */}
                  {/* Màu tên: tài khoản khách nhắn (dir=2) = primary; ADMIN/thu ngân/nhân viên (dir=1) = warning. */}
                  {!entry.own && !entry.continued ? (
                    <span
                      className={`chat-bubble__sender ${
                        entry.messages[0].dir === 2 ? 'chat-bubble__sender--member' : 'chat-bubble__sender--staff'
                      }`}
                    >
                      {entry.sender}
                    </span>
                  ) : null}
                  {entry.messages.map((message) => (
                    <div key={message.id} className="chat-bubble__line" title={formatChatTime(message.ts)}>
                      <p className="chat-bubble__text">{message.text}</p>
                      {message.truncated ? (
                        <small className="chat-bubble__note">(tin quá dài, đã cắt bớt)</small>
                      ) : null}
                    </div>
                  ))}
                  <time className="chat-bubble__time" dateTime={isoOf(lastMessage.ts)}>
                    {formatChatTime(lastMessage.ts)}
                  </time>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <ChatComposer key={convId} onSend={handleSend} hint={hint} autoFocus />
    </div>
  )
}
