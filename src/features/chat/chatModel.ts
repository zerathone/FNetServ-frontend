import type {
  ChatCardKind,
  ChatConversation,
  ChatMessage,
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
    default:
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

/** Gộp các trang (đã tải sau/trước), bỏ trùng theo `id`, xếp tăng dần theo `id`. */
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
  cash_request: 'Khách nhờ nạp tiền mặt',
  online_request: 'Khách báo nạp online',
  order_check: 'Khách nhờ kiểm tra đơn QR',
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
