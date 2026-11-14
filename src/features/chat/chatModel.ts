import type {
  ChatCaps,
  ChatCardKind,
  ChatConversation,
  ChatMessage,
  ChatReactEmoji,
  ChatReactionKind,
  ChatReactions,
  ChatReplyTo,
} from '../../api/chat'

// Logic thuần của khung chat (kênh chat Messenger mới, task chat-v2 / C3) — không import React,
// test bằng `node --test` (tests/chat-model.test.ts). Nguồn sự thật cho luật hiển thị:
// ARCHITECT/DESIGN_CHAT_MESSENGER.md mục 3.4, 4 (Validate), 5, 5.1.

export const CHAT_TEXT_LIMIT = 1000
/** Quá ngưỡng này server gom chuỗi dòng trống về 2 dòng (không từ chối). */
const MAX_BLANK_LINES = 3

/** Server đếm code point (byte đầu UTF-8); `[...s]` cũng đếm theo code point nên emoji ngoài BMP = 1. */
export function countCodePoints(text: string) {
  let n = 0
  for (const _ of text) n += 1
  return n
}

// Ký tự điều khiển trừ \n (server bỏ chúng; client bỏ trước để bộ đếm khớp).
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F﻿]/g

/**
 * Chuẩn hoá giống server (`NormalizeCodePoints`, core/chat/chat_text.cpp): `\r\n`/`\r` → `\n`, bỏ ký tự
 * điều khiển, chuỗi HƠN 3 dòng trống liên tiếp **gom về 2** (≤3 giữ nguyên), trim đầu/cuối.
 */
export function normalizeDraft(text: string) {
  const unified = text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '')
  // >3 dòng trống = ≥5 ký tự `\n` liên tiếp → 2 dòng trống = 3 `\n`.
  const collapsed = unified.replace(new RegExp(`\\n{${MAX_BLANK_LINES + 2},}`, 'g'), '\n'.repeat(3))
  return collapsed.trim()
}

export type DraftCheck =
  | { ok: true; text: string; length: number }
  | { ok: false; reason: 'empty' | 'too_long'; text: string; length: number }

export function checkDraft(raw: string): DraftCheck {
  const text = normalizeDraft(raw)
  const length = countCodePoints(text)
  if (!text) return { ok: false, reason: 'empty', text, length }
  if (length > CHAT_TEXT_LIMIT) return { ok: false, reason: 'too_long', text, length }
  return { ok: true, text, length }
}

/** Lỗi server (`message` của envelope) → câu tiếng Việt. Không khớp thì giữ nguyên để người dùng báo lại. */
export function describeChatError(message: string) {
  switch (message) {
    case 'chat_v2_disabled':
      return 'Kênh chat Messenger đang tắt trong Cài đặt.'
    case 'empty':
      return 'Tin nhắn trống.'
    case 'too_long':
      return `Tin nhắn vượt quá ${CHAT_TEXT_LIMIT} ký tự.`
    case 'invalid_utf8':
      return 'Tin nhắn chứa ký tự không hợp lệ.'
    case 'store_error':
      return 'Máy chủ không lưu được tin nhắn (kho chat lỗi). Kiểm tra thư mục lưu trong Cài đặt.'
    case 'convId invalid':
      return 'Hội thoại không hợp lệ.'
    // task chat-C9: chống spam + phản ứng + trả lời (server: handoff C7 mục 0.2 / 4.5)
    case 'BURST_LOCKED':
      return 'Bạn gửi tin quá nhanh nên tạm bị khoá gửi tin.'
    case 'RATE_LIMITED':
      return 'Bạn thao tác quá nhiều trong 1 phút, vui lòng chờ một chút rồi thử lại.'
    case 'REACT_LIMIT':
      return 'Tin này đã có quá nhiều phản ứng (giới hạn của máy chủ).'
    case 'REACT_TARGET_NOT_FOUND':
      return 'Không tìm thấy tin để thả phản ứng.'
    case 'REACT_TARGET_EXPIRED':
      return 'Tin này đã quá hạn lưu trữ nên không thả phản ứng được.'
    case 'REPLY_TARGET_NOT_FOUND':
      return 'Không tìm thấy tin gốc để trả lời (có thể đã bị xoá do quá hạn lưu).'
    default:
      // Lỗi validate của server (`count invalid`, `targetId invalid`, `replyToId invalid`, `react_invalid`…) chỉ xảy ra
      // khi có bug phía gọi — thay vì hiện nguyên tiếng Anh trong toast thì nói chung chung.
      if (/\binvalid\b|react_invalid/i.test(message) && !/json|body/i.test(message)) return 'Yêu cầu không hợp lệ.'
      // fetch() ném TypeError tiếng Anh khi mất mạng/server tắt.
      if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
        return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
      }
      return message || 'Không gửi được tin nhắn.'
  }
}

/** ISO-8601 an toàn cho `<time dateTime>`: `ts` hỏng không được làm sập cả luồng (`toISOString` ném RangeError). */
export function isoOf(ts: number) {
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

// ---- Thiết lập (Settings → "Kênh chat Messenger") ---------------------------------------------------

export const CHAT_RETENTION_MIN_DAYS = 1
export const CHAT_RETENTION_MAX_DAYS = 365
export const CHAT_RETENTION_DEFAULT_DAYS = 30

/** `null` = hợp lệ. `autoPurge` tắt ⇒ gửi 0 (không tự xoá); bật ⇒ số nguyên 1–365. */
export function validateChatRetention(autoPurge: boolean, days: number) {
  if (!autoPurge) return null
  if (!Number.isInteger(days) || days < CHAT_RETENTION_MIN_DAYS || days > CHAT_RETENTION_MAX_DAYS) {
    return `Số ngày giữ lịch sử phải là số nguyên từ ${CHAT_RETENTION_MIN_DAYS} đến ${CHAT_RETENTION_MAX_DAYS}.`
  }
  return null
}

/** Lỗi `PUT /settings/chat` (xem SettingsHandlers.cpp ChatSettingsRequestHandler) → tiếng Việt. */
export function describeChatSettingsError(message: string) {
  if (message.includes('network_drive')) return 'Thư mục lưu phải nằm trên ổ cục bộ của máy chủ (không dùng đường dẫn mạng / ổ mạng).'
  if (message.includes('too_long')) return 'Đường dẫn thư mục quá dài.'
  if (message.startsWith('storagePath not usable')) {
    return `Máy chủ không ghi được vào thư mục này (${message.replace('storagePath not usable: ', '')}). Kiểm tra đường dẫn và quyền ghi.`
  }
  if (message.startsWith('storagePath invalid')) {
    return `Đường dẫn thư mục không hợp lệ (${message.replace('storagePath invalid: ', '')}). Dùng đường dẫn tuyệt đối trên ổ cục bộ, không chứa "..".`
  }
  if (message.startsWith('retentionDays')) return 'Số ngày giữ lịch sử không hợp lệ (0 = không tự xoá, hoặc 1–365).'
  return message || 'Không lưu được thiết lập.'
}

// ---- Bên nào của bong bóng -------------------------------------------------------------------

/**
 * "Tin của tôi" = tin nhân viên NÀY gõ từ fnet-web (`src=2` + `staffId` trùng phiên đăng nhập) ⇒ bên PHẢI.
 * Khách, nhân viên khác và thu ngân gõ ở MFC (`src=1`, `staffId=0` — rule cứng cấm đọc `g_lStaffId`) ⇒ bên TRÁI.
 */
export function isOwnMessage(message: Pick<ChatMessage, 'dir' | 'src' | 'staffId'>, staffId: number | null) {
  return message.dir === 1 && message.src === 2 && !!staffId && message.staffId === staffId
}

/** Tên hiển thị trên bong bóng bên trái (tin của tôi không cần tên). */
export function senderLabel(message: ChatMessage) {
  if (message.dir === 2) return message.user || message.host || 'Khách'
  return message.staffName || 'Thu ngân'
}

// ---- Danh sách tin ---------------------------------------------------------------------------

/**
 * Gộp các trang (đã tải sau/trước), bỏ trùng theo `id`, xếp tăng dần theo `id`.
 * Cùng `id` ở nhiều nhóm ⇒ nhóm ĐỨNG SAU thắng (truyền trang mới nhất ở cuối) — nhờ vậy `reactions` mới
 * nhất của tin đã tải trước đó được cập nhật, không giữ số tim cũ.
 */
export function mergeMessages(...groups: ReadonlyArray<ReadonlyArray<ChatMessage>>): ChatMessage[] {
  const byId = new Map<number, ChatMessage>()
  for (const group of groups) for (const message of group) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** Khoá phiên: phiên đăng nhập (`sess`) nếu có, không thì theo máy (khách vãng lai chưa có `sess`). */
export function sessionKey(message: Pick<ChatMessage, 'sess' | 'host'>) {
  return message.sess > 0 ? `s${message.sess}` : `h${message.host}`
}

export type TimelineEntry =
  | { type: 'session'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: ChatMessage }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** `20:15 hôm nay` · `20:15 hôm qua` · `20:15 09/11` (kèm năm nếu khác năm hiện tại). */
export function formatChatTime(ts: number, now: number = Date.now()) {
  const d = new Date(ts)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const dayDiff = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)
  if (dayDiff === 0) return time
  if (dayDiff === 1) return `${time} hôm qua`
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
  return new Date(now).getFullYear() === d.getFullYear()
    ? `${time} ${date}`
    : `${time} ${date}/${d.getFullYear()}`
}

export function sessionLabel(first: ChatMessage, now: number = Date.now()) {
  const when = formatChatTime(first.ts, now)
  return first.host ? `Phiên ${when} · ${first.host}` : `Phiên ${when}`
}

/**
 * Dựng luồng hiển thị: vạch "Phiên …" khi đổi phiên, vạch "Tin mới" trước tin KHÁCH đầu tiên chưa đọc
 * (`id > staffRead`). Chỉ tin từ khách (dir=2) mới tính là chưa đọc — khớp cách server đếm `unreadStaff`.
 */
export function buildTimeline(
  messages: ReadonlyArray<ChatMessage>,
  staffRead: number,
  now: number = Date.now(),
): TimelineEntry[] {
  const out: TimelineEntry[] = []
  let lastSession = ''
  let unreadMarked = false
  for (const message of messages) {
    const key = sessionKey(message)
    if (key !== lastSession) {
      out.push({ type: 'session', key: `session-${message.id}`, label: sessionLabel(message, now) })
      lastSession = key
    }
    if (!unreadMarked && message.dir === 2 && message.id > staffRead) {
      out.push({ type: 'unread', key: `unread-${message.id}` })
      unreadMarked = true
    }
    out.push({ type: 'message', key: `message-${message.id}`, message })
  }
  return out
}

/** Hai tin liên tiếp của cùng một người cách nhau không quá khoảng này thì gộp chung 1 bong bóng. */
export const GROUP_GAP_MS = 2 * 60 * 1000

export type DisplayEntry =
  | Exclude<TimelineEntry, { type: 'message' }>
  | { type: 'card'; key: string; message: ChatMessage }
  | {
      type: 'group'
      key: string
      own: boolean
      sender: string
      /** Bong bóng ngay sau bong bóng của CHÍNH người này (chỉ tách vì quá `gapMs`) ⇒ UI không lặp lại tên. */
      continued: boolean
      messages: ChatMessage[]
    }

/** Người gửi để so "cùng một người": tin của tôi; khách (tên tài khoản/máy); thu ngân/nhân viên khác (tên + nguồn). */
function senderKey(message: ChatMessage, own: boolean) {
  if (own) return 'own'
  return message.dir === 2 ? `c:${message.user || message.host}` : `s:${message.src}:${message.staffId}:${message.staffName}`
}

/**
 * Gộp các tin chat gần nhau của CÙNG một người thành một bong bóng nhiều dòng. Ngắt nhóm khi:
 *  - đổi người gửi (kể cả đổi bên trái/phải),
 *  - cách tin trước quá `gapMs` (tính giữa hai tin LIÊN TIẾP, nên chuỗi gõ liên tục vẫn dính một nhóm),
 *  - gặp vạch "Phiên …" / "Tin mới" (khách thấy ranh giới đúng chỗ) hoặc một thẻ lệnh.
 * Key nhóm = id tin ĐẦU nên không đổi khi có thêm tin vào nhóm (React không dựng lại bong bóng).
 */
export function groupTimeline(
  timeline: ReadonlyArray<TimelineEntry>,
  staffId: number | null,
  gapMs: number = GROUP_GAP_MS,
): DisplayEntry[] {
  const out: DisplayEntry[] = []
  for (const entry of timeline) {
    if (entry.type !== 'message') {
      out.push(entry)
      continue
    }
    const { message } = entry
    if (cardOf(message)) {
      out.push({ type: 'card', key: entry.key, message })
      continue
    }
    const own = isOwnMessage(message, staffId)
    const key = senderKey(message, own)
    const last = out[out.length - 1]
    let continued = false
    if (last?.type === 'group') {
      const prev = last.messages[last.messages.length - 1]
      if (senderKey(prev, last.own) === key) {
        if (Math.abs(message.ts - prev.ts) <= gapMs) {
          last.messages.push(message)
          continue
        }
        // Cùng người nhưng cách quá lâu ⇒ bong bóng mới, song liền kề bong bóng trước (không có vạch/thẻ xen giữa).
        continued = true
      }
    }
    out.push({
      type: 'group',
      key: `group-${message.id}`,
      own,
      sender: senderLabel(message),
      continued,
      messages: [message],
    })
  }
  return out
}

/** Id tin lớn nhất từ khách — mốc `upToId` khi đánh dấu đã đọc. 0 = không có tin khách. */
export function latestInboundId(messages: ReadonlyArray<ChatMessage>) {
  let id = 0
  for (const message of messages) if (message.dir === 2 && message.id > id) id = message.id
  return id
}

// ---- Thẻ lệnh (DESIGN 5.1: chỉ HIỂN THỊ, không nút hành động ghi tiền) --------------------------

export type CardView = {
  kind: ChatCardKind
  title: string
  amount: number | null
  orderId: string | null
}

const CARD_TITLES: Record<ChatCardKind, string> = {
  cash_request: 'Yêu cầu nạp tiền mặt',
  online_request: 'Báo nạp online',
  order_check: 'Kiểm tra đơn QR',
}

function metaAmount(meta: ChatMessage['meta']) {
  const value = meta?.amount
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * `null` ⇒ vẽ bong bóng chat thường. Thẻ chỉ dựng khi `meta` đủ dữ liệu — lệnh hỏng/thiếu số tiền đã được
 * server hạ về `kind=chat`, nhưng FE vẫn không tin `kind` mù quáng (server cũ/dữ liệu lạ không được làm
 * hỏng khung).
 */
export function cardOf(message: Pick<ChatMessage, 'kind' | 'meta'>): CardView | null {
  if (message.kind === 'chat') return null
  if (!(message.kind in CARD_TITLES)) return null
  const amount = metaAmount(message.meta)
  const rawOrder = message.meta?.orderId
  const orderId = typeof rawOrder === 'string' && rawOrder ? rawOrder : null
  if (amount === null) return null
  if (message.kind === 'order_check' && !orderId) return null
  return { kind: message.kind, title: CARD_TITLES[message.kind], amount, orderId }
}

// ---- Danh sách hội thoại ----------------------------------------------------------------------

/**
 * Server mới chỉ lọc `q` theo `convId` + tin cuối (handoff C2, thay đổi phát sinh 5) nên FE lọc thêm theo
 * tên tài khoản/máy trên trang đã tải. Không phân biệt hoa thường và dấu tiếng Việt.
 */
export function foldVietnamese(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Nhãn nhóm hội thoại theo MÁY (không phải theo tài khoản hội viên): khách vãng lai, và combo/admin đăng nhập
 * trực tiếp — server gom chung vào `g<HOST>` (DESIGN 3.2, C0(b)).
 */
export const GUEST_LABEL = 'Khách vãng lai & combo'

/** Phần máy trạm cần để dựng hội thoại (khớp `WorkstationRuntime` của /workstations/runtime). */
export type ChatMachineRef = { hostName: string; userId: number; userName: string | null; userGroupType: number }

// UserGroupType phía server: MEMBER = 2, STAFF = 4 ⇒ hội thoại theo TÀI KHOẢN (u<uid>); còn lại (vãng lai 1, combo 5, admin)
// ⇒ hội thoại theo MÁY (g<HOST>). Khớp `IsAccountSession` ở ChatBridge.cpp.
const ACCOUNT_GROUP_TYPES: readonly number[] = [2, 4]
const HOST_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/

/**
 * Dựng hội thoại chat của máy đang có phiên — cùng quy tắc `ConvId` của server (tên máy IN HOA, whitelist ký tự).
 * Trả null khi tên máy server không nhận ⇒ nơi gọi dùng đường nhắn tin cũ.
 */
export function machineConversation(machine: ChatMachineRef | null | undefined): ChatConversation | null {
  if (!machine) return null
  const host = machine.hostName.trim().toUpperCase()
  if (!HOST_NAME_RE.test(host) || host === '.' || host === '..' || host.endsWith('.')) return null
  const rest = { online: true, lastText: '', lastAt: 0, lastId: 0, unread: 0, hostName: host }
  if (Number.isInteger(machine.userId) && machine.userId > 0 && ACCOUNT_GROUP_TYPES.includes(machine.userGroupType)) {
    return {
      ...rest,
      convId: `u${machine.userId}`,
      kind: 'account',
      title: machine.userName || `u${machine.userId}`,
      uid: machine.userId,
      utype: machine.userGroupType === 4 ? 'staff' : 'member',
    }
  }
  return { ...rest, convId: `g${host}`, kind: 'host', title: host, utype: machine.userGroupType === 5 ? 'combo' : 'anonym' }
}

const UTYPE_LABEL: Record<string, string> = {
  member: 'Hội viên',
  staff: 'Nhân viên',
  anonym: 'Khách vãng lai',
  combo: 'Combo',
  admin: 'Quản trị',
}

/**
 * Dòng phụ của một máy trong danh sách "Nhắn tin mới": tài khoản ⇒ tên máy đang ngồi (nhân viên thêm nhãn);
 * khách vãng lai / combo / quản trị (title đã là tên máy) ⇒ nhãn loại phiên.
 */
export function peerSubtitle(peer: ChatConversation) {
  const label = UTYPE_LABEL[peer.utype ?? ''] ?? ''
  if (peer.kind === 'host') return label || GUEST_LABEL
  const host = peer.hostName ?? ''
  return peer.utype === 'staff' && label ? [host, label].filter(Boolean).join(' · ') : host
}

/** Trường tìm kiếm (giống ô tìm ở trang Máy trạm / Đơn dịch vụ): tài khoản · máy · nội dung tin cuối; `any` = mọi trường. */
export type ChatSearchField = 'user' | 'pc' | 'text' | 'any'

export function conversationMatches(conversation: ChatConversation, query: string, field: ChatSearchField = 'any') {
  const needle = foldVietnamese(query.trim())
  if (!needle) return true
  // Hội thoại khách vãng lai đặt tên theo máy (title = tên máy) nên "máy" cũng khớp title của nó.
  const pcNames = [conversation.hostName ?? '', conversation.kind === 'host' ? conversation.title : '']
  const fields =
    field === 'user'
      ? [conversation.title]
      : field === 'pc'
        ? pcNames
        : field === 'text'
          ? [conversation.lastText]
          : [conversation.title, ...pcNames, conversation.convId, conversation.lastText]
  return fields.some((value) => foldVietnamese(value).includes(needle))
}

/** Gợi ý cho datalist của ô tìm: tên tài khoản hoặc tên máy trong các hội thoại đã tải (bỏ trùng, giữ thứ tự). */
export function searchSuggestions(conversations: ReadonlyArray<ChatConversation>, field: ChatSearchField) {
  if (field === 'text' || field === 'any') return []
  const out = new Set<string>()
  for (const conversation of conversations) {
    if (field === 'user') {
      if (conversation.kind === 'account' && conversation.title) out.add(conversation.title)
    } else {
      if (conversation.hostName) out.add(conversation.hostName)
      if (conversation.kind === 'host' && conversation.title) out.add(conversation.title)
    }
  }
  return [...out]
}

/**
 * Phần mờ đặt cạnh tên hội thoại, ngăn bằng dấu chấm tròn ở UI: tài khoản đang ngồi máy ⇒ tên máy;
 * khách vãng lai (title đã là tên máy) ⇒ "Khách vãng lai"; tài khoản offline ⇒ rỗng.
 */
export function conversationTag(conversation: ChatConversation) {
  if (conversation.kind === 'host') return GUEST_LABEL
  return conversation.hostName ?? ''
}

/** Badge đỏ: `99+` khi quá 99; rỗng khi 0. */
export function badgeText(count: number) {
  if (!(count > 0)) return ''
  return count > 99 ? '99+' : String(count)
}

/**
 * Số tin chưa đọc của CÁC HỘI THOẠI KHÁC (badge ở nút "<" khi đang mở một thread): tổng chưa đọc trừ phần của
 * thread đang xem. Thread đang mở sẽ sớm được đánh dấu đã đọc, nhưng trừ sẵn để badge không nháy số thừa trong
 * khoảng chờ server xác nhận.
 */
export function otherUnreadCount(unreadTotal: number, currentUnread: number) {
  return Math.max(0, (unreadTotal || 0) - Math.max(0, currentUnread || 0))
}

/** Chu kỳ dự phòng khi WS rớt: server tắt chat/bản cũ thì hỏi thưa (5 phút) để biết khi admin bật cờ. */
export const CHAT_POLL_ENABLED_MS = 60_000
export const CHAT_POLL_DISABLED_MS = 300_000

// ---- Bảng icon: ~48 emoji Unicode, không ảnh, không dependency (DESIGN mục 5 "Icon") -------------

export const EMOJI_GROUPS: ReadonlyArray<{ label: string; items: readonly string[] }> = [
  { label: 'Cười', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😭', '😡'] },
  { label: 'Cử chỉ', items: ['👍', '👎', '👌', '🙏', '👏', '🙌', '💪', '👋', '🤝', '✌️', '🤞', '🫡'] },
  { label: 'Biểu tượng', items: ['❤️', '🔥', '⭐', '✅', '❌', '⚠️', '❓', '❗', '💯', '🎉', '🎁', '💰'] },
  { label: 'Phòng máy', items: ['🎮', '🖥️', '⌨️', '🖱️', '🎧', '📶', '🍜', '☕', '🥤', '🍟', '💳', '🧾'] },
]

/** Chèn `insert` vào `text` tại vùng chọn [start, end) — trả chuỗi mới + vị trí con trỏ sau khi chèn. */
export function insertAtSelection(text: string, insert: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return { text: text.slice(0, from) + insert + text.slice(to), cursor: from + insert.length }
}

/** `clientMsgId` chống gửi trùng (server: `^[A-Za-z0-9_.:-]{1,64}$`). */
export function newClientMsgId(random: () => number = Math.random, now: number = Date.now()) {
  return `w${now.toString(36)}-${Math.floor(random() * 0xffffffff).toString(36)}`
}

// ---- Phản ứng (❤️ 👍 😂) + trả lời + khoá chống dồn tin (task chat-C9) -----------------------------------------
// Luật server: handoff/HANDOFF_chat_C7.md mục 0.1 (D1–D6), 0.2 (burst lock), 4 (API). Mọi hàm thuần (test: tests/chat-model.test.ts).

export const REACTION_ORDER: readonly ChatReactionKind[] = ['heart', 'thumb', 'laugh']
export const REACTION_EMOJI: Readonly<Record<ChatReactionKind, string>> = { heart: '❤️', thumb: '👍', laugh: '😂' }
export const REACTION_LABEL: Readonly<Record<ChatReactionKind, string>> = {
  heart: 'Thả tim',
  thumb: 'Thích',
  laugh: 'Cười',
}
/** Trần ❤️ mỗi người mỗi tin (D1). 👍/😂 mỗi người một lần. */
export const MAX_HEART_PER_USER = 10

export type ReactionChip = { kind: ChatReactionKind; emoji: string; n: number; mine: number }

function wholeNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Chip hiển thị dưới dòng tin: thứ tự cố định ❤️ 👍 😂, chỉ loại có n > 0 (số hỏng/âm bị bỏ). */
export function reactionChips(reactions: ChatReactions | undefined | null): ReactionChip[] {
  if (!reactions) return []
  const out: ReactionChip[] = []
  for (const kind of REACTION_ORDER) {
    const entry = reactions[kind]
    const n = wholeNumber(entry?.n)
    if (n <= 0) continue
    out.push({ kind, emoji: REACTION_EMOJI[kind], n, mine: Math.min(wholeNumber(entry?.mine), n) })
  }
  return out
}

/** Tổng số phản ứng của TÔI trên tin (quyết định có hiện nút "Xoá" hay không). */
export function myReactionTotal(reactions: ChatReactions | undefined | null) {
  return reactionChips(reactions).reduce((sum, chip) => sum + chip.mine, 0)
}

/** Một thao tác của người dùng: ❤️ = +1; 👍/😂 = bật/tắt; `clear` = xoá hết của tôi. */
export type ReactionAction = ChatReactionKind | 'clear'
export type ReactionRequest = { emoji: ChatReactEmoji; count: number }

/**
 * Đổi thao tác thành SỐ MONG MUỐN gửi server (trạng thái tuyệt đối ⇒ retry không cộng đôi).
 * `null` = không có gì để gửi (❤️ đã chạm trần 10; "Xoá" khi tôi chưa thả gì).
 */
export function reactionRequestFor(
  reactions: ChatReactions | undefined | null,
  action: ReactionAction,
): ReactionRequest | null {
  if (action === 'clear') return myReactionTotal(reactions) > 0 ? { emoji: 'all', count: 0 } : null
  const mine = reactionChips(reactions).find((chip) => chip.kind === action)?.mine ?? 0
  if (action === 'heart') return mine >= MAX_HEART_PER_USER ? null : { emoji: 'heart', count: mine + 1 }
  return { emoji: action, count: mine > 0 ? 0 : 1 }
}

/** Áp lạc quan yêu cầu lên bản sao `reactions` (không đổi bản gốc). Server vẫn là bên quyết định. */
export function applyReactionRequest(
  reactions: ChatReactions | undefined | null,
  request: ReactionRequest,
): ChatReactions {
  const next: ChatReactions = {}
  for (const chip of reactionChips(reactions)) {
    if (request.emoji === 'all') {
      const n = chip.n - chip.mine
      if (n > 0) next[chip.kind] = { n, mine: 0 }
    } else if (chip.kind === request.emoji) {
      const n = chip.n - chip.mine + request.count
      if (n > 0) next[chip.kind] = { n, mine: request.count }
    } else {
      next[chip.kind] = { n: chip.n, mine: chip.mine }
    }
  }
  if (request.emoji !== 'all' && request.count > 0 && !next[request.emoji]) {
    next[request.emoji] = { n: request.count, mine: request.count }
  }
  return next
}

/** Nhãn đọc-màn-hình cho chip, vd "Thả tim: 7 (bạn 2)". */
export function chipLabel(chip: ReactionChip) {
  return `${REACTION_LABEL[chip.kind]}: ${chip.n}${chip.mine > 0 ? ` (bạn ${chip.mine})` : ''}`
}

/** Khối trích dẫn hợp lệ của tin trả lời (`meta.replyTo`); thiếu/hỏng ⇒ `null`. */
export function replyOf(message: Pick<ChatMessage, 'meta'>): ChatReplyTo | null {
  const raw = message.meta?.replyTo
  if (!raw || typeof raw !== 'object') return null
  const reply = raw as Record<string, unknown>
  const id = Number(reply.id)
  if (!Number.isFinite(id) || id <= 0) return null
  return {
    id,
    dir: reply.dir === 1 ? 1 : 2,
    who: typeof reply.who === 'string' ? reply.who : '',
    text: typeof reply.text === 'string' ? reply.text : '',
  }
}

/** Tên người gửi tin gốc để hiển thị trong trích dẫn / ô "Đang trả lời". */
export function replyWho(reply: Pick<ChatReplyTo, 'dir' | 'who'>) {
  return reply.who || (reply.dir === 2 ? 'Khách' : 'Thu ngân')
}

/** Server cũ không có `caps` ⇒ ẩn nút (dùng chung cho thả tim và trả lời). */
export function canReact(caps: ChatCaps | undefined | null) {
  return caps?.react === true
}
export function canReply(caps: ChatCaps | undefined | null) {
  return caps?.reply === true
}

// ---- Khoá chống dồn tin (D3 / 0.2): ≥ 3 lần gửi trong 1 s là không chấp nhận được -------------------------------

export const BURST_COUNT = 3
export const BURST_WINDOW_MS = 1000
/** Mức khoá thấp nhất của server (60 s). Khi server trả `retryAfterSec` thì theo số đó. */
export const BURST_CLIENT_LOCK_SEC = 60

/**
 * Ghi nhận 1 lần gửi lúc `now`. Lần thứ `BURST_COUNT` trong cửa sổ `BURST_WINDOW_MS` ⇒ `burst: true`
 * (lần đó KHÔNG được gửi; caller khoá khung soạn). Chỉ để khoá NGAY phía khách — server mới là bên quyết định.
 */
export function detectBurst(history: readonly number[], now: number): { history: number[]; burst: boolean } {
  const recent = history.filter((time) => now - time < BURST_WINDOW_MS && now >= time)
  if (recent.length + 1 >= BURST_COUNT) return { history: [], burst: true }
  return { history: [...recent, now], burst: false }
}

/**
 * `retryAfterSec` mà server nhét ở `data` của lỗi `BURST_LOCKED` / `RATE_LIMITED` (object, hoặc chuỗi JSON tuỳ
 * đường trả). `null` = lỗi khác / thiếu số / số hỏng ⇒ caller dùng mức mặc định.
 */
export function retryAfterSecOf(message: string, details: unknown): number | null {
  if (message !== 'BURST_LOCKED' && message !== 'RATE_LIMITED') return null
  let data: unknown = details
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  const sec = Number((data as { retryAfterSec?: unknown } | null | undefined)?.retryAfterSec)
  return Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : null
}

/** Số giây còn lại của khoá (làm tròn lên); 0 = đã mở. */
export function remainingLockSec(lockedUntil: number, now: number) {
  return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0
}

/** `m:ss` cho đồng hồ đếm ngược. */
export function formatCountdown(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
