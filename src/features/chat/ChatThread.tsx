import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowBendUpLeft, CurrencyCircleDollar, QrCode, Receipt, XCircle } from '@phosphor-icons/react'
import {
  CHAT_QUERY_KEY,
  chatRetryAfterSec,
  listChatMessages,
  markChatRead,
  reactToChatMessage,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatReactions,
} from '../../api/chat'
import { Button, InlineAlert, StateView } from '../../design-system/components'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { useWsStatusStore } from '../../store/wsStatus'
import { formatVnd } from '../orders/orderPayModel'
import { ChatComposer } from './ChatComposer'
import { useChatLockStore } from './chatLockStore'
import { useLiveConversation } from './useLiveConversation'
import {
  applyReactionRequest,
  BURST_CLIENT_LOCK_SEC,
  buildTimeline,
  canReact,
  canReply,
  cardOf,
  chipLabel,
  describeChatError,
  detectBurst,
  formatChatTime,
  groupTimeline,
  isoOf,
  latestInboundId,
  mergeMessages,
  myReactionTotal,
  newClientMsgId,
  senderLabel,
  REACTION_EMOJI,
  REACTION_LABEL,
  REACTION_ORDER,
  reactionChips,
  reactionRequestFor,
  replyOf,
  replyWho,
  type CardView,
  type ReactionAction,
  type ReactionRequest,
} from './chatModel'

const PAGE_SIZE = 50
/** Nhảy tới tin gốc: tải thêm tối đa chừng này trang cũ rồi báo "ở phần cũ hơn" (handoff C7 mục 5). */
const JUMP_MAX_OLDER_PAGES = 3
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
        <Icon size={16} weight="duotone" aria-hidden="true" />
        <strong>{card.title}</strong>
      </div>
      <dl className="chat-card__body">
        {card.amount !== null ? (
          <div className="chat-card__amount-group">
            <dt>Số tiền</dt>
            <dd className="chat-card__amount">{formatVnd(card.amount)}</dd>
            {/* Tên máy: không nhãn, in mờ ngay dưới số tiền (bỏ "Hội viên" vì đang chat với chính hội viên đó). */}
            <dd className="chat-card__host" title={message.host || undefined}>
              {message.host || '—'}
            </dd>
          </div>
        ) : null}
        {card.orderId ? (
          <div>
            <dt>Mã đơn</dt>
            <dd>{card.orderId}</dd>
          </div>
        ) : null}
      </dl>
      <div className="chat-card__footer">
        <time className="chat-card__time" dateTime={isoOf(message.ts)}>
          {formatChatTime(message.ts)}
        </time>
      </div>
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
    // `startedAt` = lúc BẮT ĐẦU tải (không phải lúc tải xong): bản này chỉ phản ánh phản ứng xảy ra trước mốc đó,
    // nên chỉ được thay override lạc quan có `at` ≤ startedAt (xem `view`).
    queryFn: async () => {
      const startedAt = Date.now()
      return { ...(await listChatMessages({ convId, limit: PAGE_SIZE })), startedAt }
    },
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

  // ---- Phản ứng: cập nhật LẠC QUAN rồi đối chiếu với server (task chat-C9) ---------------------------------
  // `overrides` = số phản ứng tôi vừa đổi, phủ lên dữ liệu server cho tới khi có bản server MỚI HƠN
  // (trang mới nhất refetch sau thời điểm đổi). Tin ở trang cũ (không refetch) giữ bản server trả lúc thả.
  const caps = latestQuery.data?.caps
  const reactEnabled = canReact(caps)
  const replyEnabled = canReply(caps)
  // `at` = Infinity trong lúc còn request chưa xong cho tin đó (không bản tải nào được phép đè); xong thì `at` = lúc xong.
  const [overrides, setOverrides] = useState<Record<number, { reactions: ChatReactions; at: number }>>({})
  const latestStartedAt = latestQuery.data?.startedAt ?? 0
  const latestIds = useMemo(() => new Set(latestItems?.map((item) => item.id)), [latestItems])
  const view = useMemo(
    () =>
      messages.map((message) => {
        const override = overrides[message.id]
        if (!override) return message
        if (latestIds.has(message.id) && override.at <= latestStartedAt) return message
        return { ...message, reactions: override.reactions }
      }),
    [messages, overrides, latestIds, latestStartedAt],
  )
  // Dọn HẲN override đã bị bản server mới hơn thay thế — nếu chỉ "bỏ qua" thì khi tin rơi khỏi trang mới nhất
  // (>50 tin sau đó) override cũ sống lại và kéo số của người khác về giá trị cũ.
  useEffect(() => {
    if (!latestStartedAt) return
    setOverrides((current) => {
      let next: typeof current | null = null
      for (const key of Object.keys(current)) {
        const id = Number(key)
        if (latestIds.has(id) && current[id].at <= latestStartedAt) {
          next ??= { ...current }
          delete next[id]
        }
      }
      return next ?? current
    })
  }, [latestStartedAt, latestIds])

  // Trạng thái SỐNG của hội thoại (đang ngồi máy nào / online) — dùng chung với header khung chat (ChatCenter).
  const live = useLiveConversation(conversation) ?? conversation

  // Mốc "đã đọc" để vẽ vạch "Tin mới" — CHỐT lúc mở hội thoại, không đuổi theo con trỏ vừa đánh dấu
  // (nếu không vạch biến mất ngay khi mở, khách đã gửi gì không biết).
  const dividerReadRef = useRef<number | null>(null)
  if (dividerReadRef.current === null && latestQuery.data) {
    dividerReadRef.current = latestQuery.data.staffRead
  }
  const timeline = useMemo(
    () => buildTimeline(view, dividerReadRef.current ?? latestQuery.data?.staffRead ?? 0),
    [view, latestQuery.data?.staffRead],
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
  // Hàng chip của tin CUỐI làm dòng cao thêm — đang dính đáy thì phải cuộn theo, không để chip nằm dưới mép.
  const lastReactionSig = view.length ? JSON.stringify(view[view.length - 1].reactions ?? {}) : ''
  // Dùng chung cho "Tải tin cũ hơn" và "nhảy tới tin gốc": không để 2 đường cùng tải trang cũ (prevHeightRef bị bỏ lại).
  const olderBusyRef = useRef(false)

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
  }, [lastMessageId, messages.length, lastReactionSig])

  // ---- Trả lời + khoá chống dồn tin ------------------------------------------------------------------
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null)
  const replyView = useMemo(() => {
    if (!replyTarget) return null
    return { id: replyTarget.id, who: senderLabel(replyTarget), text: replyTarget.text }
  }, [replyTarget])
  const lockedUntil = useChatLockStore((state) => state.lockedUntil)
  const lockChat = useChatLockStore((state) => state.lock)
  const clearLock = useChatLockStore((state) => state.clear)
  const onLockExpired = useCallback(() => clearLock(), [clearLock])
  const sendTimesRef = useRef<number[]>([])

  const sendMutation = useMutation({
    mutationFn: (vars: { text: string; clientMsgId: string; replyToId?: number }) =>
      sendChatMessage({
        convId,
        text: vars.text,
        clientMsgId: vars.clientMsgId,
        ...(vars.replyToId ? { replyToId: vars.replyToId } : {}),
      }),
  })
  // Giữ `clientMsgId` cho tới khi gửi XONG: gửi lại sau lỗi mạng cùng 1 id ⇒ server chống trùng.
  const pendingIdRef = useRef<{ text: string; replyToId: number; id: string } | null>(null)

  const handleSend = async (text: string) => {
    // Khoá NGAY phía khách khi dồn ≥ 3 lần gửi / 1 s (server vẫn là bên quyết định, xem BURST_LOCKED bên dưới).
    const burst = detectBurst(sendTimesRef.current, Date.now())
    sendTimesRef.current = burst.history
    if (burst.burst) {
      lockChat(BURST_CLIENT_LOCK_SEC)
      throw new Error(describeChatError('BURST_LOCKED'))
    }
    const replyToId = replyTarget?.id ?? 0
    const pending =
      pendingIdRef.current && pendingIdRef.current.text === text && pendingIdRef.current.replyToId === replyToId
        ? pendingIdRef.current
        : { text, replyToId, id: newClientMsgId() }
    pendingIdRef.current = pending
    let result
    try {
      result = await sendMutation.mutateAsync({ text, clientMsgId: pending.id, replyToId })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const retryAfter = chatRetryAfterSec(error)
      // Khoá khung soạn đúng số giây server trả; thiếu số thì dùng mức thấp nhất (60 s) chứ không bỏ trống.
      if (message === 'BURST_LOCKED') lockChat(retryAfter ?? BURST_CLIENT_LOCK_SEC)
      // Lỗi mạng (request chưa tới server): không tính vào bộ đếm dồn tin — bấm Enter thử lại liên tục lúc mất mạng
      // không được tự khoá người dùng. Lỗi nghiệp vụ (ApiError) thì server đã nhận nên vẫn tính.
      if (!(error instanceof ApiError)) sendTimesRef.current = sendTimesRef.current.slice(0, -1)
      if (message === 'REPLY_TARGET_NOT_FOUND') setReplyTarget(null) // tin gốc đã mất: bỏ trích dẫn, giữ bản nháp
      const friendly = describeChatError(message)
      throw new Error(message === 'RATE_LIMITED' && retryAfter ? `${friendly} (khoảng ${retryAfter} giây)` : friendly)
    }
    pendingIdRef.current = null
    setReplyTarget(null)
    // Server đã lưu nhưng không có máy nào nhận (khách vừa rời máy / tài khoản offline) — nói rõ, đừng
    // để bong bóng trông như đã tới tay khách.
    setNotice(result.delivered ? '' : NOT_DELIVERED_NOTICE[live.kind])
    stickRef.current = true
    await queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })
  }

  const loadOlder = async () => {
    if (loadingOlder || olderBusyRef.current || !messages.length) return
    olderBusyRef.current = true
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
      olderBusyRef.current = false
      setLoadingOlder(false)
    }
  }

  // ---- Thả phản ứng: lạc quan → HÀNG ĐỢI theo từng tin → đối chiếu ----------------------------------------
  // Mỗi tin chỉ có MỘT request chạy cùng lúc: bấm ❤️ liên tục không gửi song song (server xử lý đa luồng, 2 request
  // "số tuyệt đối" tới lộn thứ tự có thể chốt số thấp hơn UI). Lần bấm trong lúc chờ xếp hàng; lần bấm liền sau
  // CÙNG loại thay lần trước (gộp, vì là số tuyệt đối). `base` = bản server ĐÃ XÁC NHẬN gần nhất — lỗi thì hoàn tác
  // về đây, không về trạng thái lạc quan trung gian của lần bấm trước.
  const reactChainsRef = useRef(new Map<number, { base: ChatReactions; queue: ReactionRequest[] }>())

  const runReactChain = async (id: number) => {
    const chain = reactChainsRef.current.get(id)
    if (!chain) return
    while (chain.queue.length > 0) {
      const request = chain.queue.shift() as ReactionRequest
      try {
        const result = await reactToChatMessage({ convId, targetId: id, emoji: request.emoji, count: request.count })
        chain.base = result.reactions
      } catch (error) {
        reactChainsRef.current.delete(id)
        setOverrides((current) => ({ ...current, [id]: { reactions: chain.base, at: Date.now() } }))
        void queryClient.invalidateQueries({ queryKey: [...CHAT_QUERY_KEY, 'messages'] })
        const text = error instanceof Error ? error.message : ''
        const retryAfter = chatRetryAfterSec(error)
        const friendly = describeChatError(text)
        pushToast(text === 'RATE_LIMITED' && retryAfter ? `${friendly} (khoảng ${retryAfter} giây)` : friendly, 'error')
        return
      }
    }
    // Hàng đợi cạn: bản server cuối cùng thành sự thật; override giữ tới khi có lần tải MỚI HƠN (`at` = lúc xong).
    reactChainsRef.current.delete(id)
    setOverrides((current) => ({ ...current, [id]: { reactions: chain.base, at: Date.now() } }))
    // WS `chat.reaction` sẽ làm tươi lại (throttle 2 s); chỉ tự làm tươi MỘT lần khi WS rớt.
    if (!useWsStatusStore.getState().connected) {
      void queryClient.invalidateQueries({ queryKey: [...CHAT_QUERY_KEY, 'messages'] })
    }
  }

  const reactOn = (message: ChatMessage, action: ReactionAction) => {
    const request = reactionRequestFor(message.reactions, action)
    if (!request) {
      if (action === 'heart') pushToast('Bạn đã thả tối đa 10 ❤️ cho tin này.', 'info')
      return
    }
    const id = message.id
    // `at` = vô cực: còn request chưa xong thì không bản tải nào được đè lên số lạc quan.
    setOverrides((current) => ({
      ...current,
      [id]: { reactions: applyReactionRequest(message.reactions, request), at: Number.POSITIVE_INFINITY },
    }))
    const chain = reactChainsRef.current.get(id)
    if (chain) {
      const last = chain.queue[chain.queue.length - 1]
      if (last && last.emoji === request.emoji) chain.queue[chain.queue.length - 1] = request
      else chain.queue.push(request)
      return
    }
    reactChainsRef.current.set(id, { base: message.reactions ?? {}, queue: [request] })
    void runReactChain(id)
  }

  // ---- Nhảy tới tin gốc của một tin trả lời -----------------------------------------------------------------
  const flashRef = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null)
  useEffect(
    () => () => {
      if (flashRef.current) {
        clearTimeout(flashRef.current.timer)
        flashRef.current.el.classList.remove('is-flash')
      }
    },
    [],
  )
  const scrollToMessage = (id: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`)
    if (!el) return false
    stickRef.current = false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // Gỡ nháy của tin trước (nếu còn) rồi khởi động lại animation cho tin này.
    if (flashRef.current) {
      clearTimeout(flashRef.current.timer)
      flashRef.current.el.classList.remove('is-flash')
    }
    el.classList.remove('is-flash')
    void el.offsetWidth // ép reflow để animation chạy lại khi nhảy lại đúng tin đó
    el.classList.add('is-flash')
    flashRef.current = {
      el,
      timer: setTimeout(() => {
        el.classList.remove('is-flash')
        flashRef.current = null
      }, 1800),
    }
    return true
  }
  const [jumpNotice, setJumpNotice] = useState('')
  const jumpTo = async (id: number) => {
    if (olderBusyRef.current) return // đang tải trang cũ (bấm "Tải tin cũ hơn" hoặc nhảy khác)
    olderBusyRef.current = true
    setJumpNotice('')
    try {
      if (scrollToMessage(id)) return
      // Chưa tải tin đó: tải lùi tối đa JUMP_MAX_OLDER_PAGES trang cũ rồi thôi.
      let oldest = messages.length ? messages[0].id : 0
      let more = hasMore
      for (let page = 0; page < JUMP_MAX_OLDER_PAGES && more && oldest > 0; page += 1) {
        const el = scrollRef.current
        const result = await listChatMessages({ convId, beforeId: oldest, limit: PAGE_SIZE })
        prevHeightRef.current = el && result.items.some((item) => item.id < oldest) ? el.scrollHeight : null
        setSeen((current) => mergeMessages(current, result.items))
        setOlderHasMore(result.hasMore)
        more = result.hasMore
        oldest = result.items.length ? Math.min(...result.items.map((item) => item.id)) : 0
        await new Promise((resolve) => setTimeout(resolve, 60)) // chờ React vẽ trang vừa chèn
        if (scrollToMessage(id)) return
      }
      // Hết trang cũ mà vẫn không thấy = tin gốc đã bị dọn (hạn giữ); còn trang cũ = chưa tải tới.
      setJumpNotice(
        more
          ? 'Tin gốc ở phần cũ hơn — bấm "Tải tin cũ hơn" để xem tiếp.'
          : 'Tin gốc không còn trong lịch sử (có thể đã bị xoá do quá hạn lưu).',
      )
    } catch (error) {
      setJumpNotice(describeChatError(error instanceof Error ? error.message : ''))
    } finally {
      olderBusyRef.current = false
    }
  }

  const hint = jumpNotice
    ? jumpNotice
    : notice
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
                  {entry.messages.map((message, index) => {
                    const reply = replyOf(message)
                    const chips = reactionChips(message.reactions)
                    const mineTotal = myReactionTotal(message.reactions)
                    const hasActions = reactEnabled || replyEnabled
                    const isLast = index === entry.messages.length - 1
                    return (
                      <div
                        key={message.id}
                        className={`chat-bubble__line${hasActions ? ' has-actions' : ''}`}
                        data-message-id={message.id}
                        title={formatChatTime(message.ts)}
                        // Chạm/bấm vào dòng ⇒ dòng nhận focus ⇒ hiện thanh thao tác (máy cảm ứng không có hover).
                        // tabIndex=-1: KHÔNG đưa từng dòng vào thứ tự Tab (50–200 dòng sẽ chặn bàn phím tới ô soạn);
                        // chip và khối trích dẫn vẫn Tab được. Hạn chế đã biết: chưa có phím tắt thả tim bằng bàn phím.
                        tabIndex={hasActions ? -1 : undefined}
                      >
                        {reply ? (
                          <button
                            type="button"
                            className="chat-quote"
                            onClick={() => void jumpTo(reply.id)}
                            aria-label={`Xem tin gốc của ${replyWho(reply)}`}
                          >
                            <span className="chat-quote__who">{replyWho(reply)}</span>
                            <span className="chat-quote__text">{reply.text}</span>
                          </button>
                        ) : null}
                        <p className="chat-bubble__text">{message.text}</p>
                        {message.truncated ? (
                          <small className="chat-bubble__note">(tin quá dài, đã cắt bớt)</small>
                        ) : null}
                        {chips.length || isLast ? (
                          <div className="chat-bubble__footer">
                            {isLast ? (
                              <time className="chat-bubble__time" dateTime={isoOf(message.ts)}>
                                {formatChatTime(message.ts)}
                              </time>
                            ) : null}
                            {chips.length ? (
                              <div className="chat-reactions" role="group" aria-label="Phản ứng">
                                {chips.map((chip) => (
                                  <button
                                    key={chip.kind}
                                    type="button"
                                    className={`chat-chip${chip.mine > 0 ? ' is-mine' : ''}`}
                                    disabled={!reactEnabled}
                                    // ❤️ cộng dồn (không phải bật/tắt) nên không gắn aria-pressed; 👍/😂 là bật/tắt.
                                    aria-pressed={chip.kind === 'heart' ? undefined : chip.mine > 0}
                                    aria-label={chipLabel(chip)}
                                    title={chipLabel(chip)}
                                    onClick={() => reactOn(message, chip.kind)}
                                  >
                                    <span aria-hidden="true">{chip.emoji}</span> {chip.n}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {hasActions ? (
                          <div
                            className={`chat-actions ${entry.own ? 'chat-actions--right' : 'chat-actions--left'}`}
                            role="toolbar"
                            aria-label="Thao tác với tin nhắn"
                          >
                            {reactEnabled
                              ? REACTION_ORDER.map((kind) => (
                                  <button
                                    key={kind}
                                    type="button"
                                    className="chat-actions__btn"
                                    title={kind === 'heart' ? 'Thả tim (bấm nhiều lần để thả nhiều, tối đa 10)' : REACTION_LABEL[kind]}
                                    aria-label={REACTION_LABEL[kind]}
                                    onClick={() => reactOn(message, kind)}
                                  >
                                    {REACTION_EMOJI[kind]}
                                  </button>
                                ))
                              : null}
                            {reactEnabled && mineTotal > 0 ? (
                              <button
                                type="button"
                                className="chat-actions__btn"
                                title="Xoá phản ứng của tôi"
                                aria-label="Xoá phản ứng của tôi"
                                onClick={() => reactOn(message, 'clear')}
                              >
                                <XCircle size={16} aria-hidden="true" />
                              </button>
                            ) : null}
                            {replyEnabled ? (
                              <button
                                type="button"
                                className="chat-actions__btn"
                                title="Trả lời"
                                aria-label="Trả lời"
                                onClick={() => setReplyTarget(message)}
                              >
                                <ArrowBendUpLeft size={16} aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <ChatComposer
        key={convId}
        onSend={handleSend}
        hint={hint}
        autoFocus
        replyTo={replyEnabled ? replyView : null}
        onCancelReply={() => setReplyTarget(null)}
        lockedUntil={lockedUntil}
        onLockExpired={onLockExpired}
      />
    </div>
  )
}
