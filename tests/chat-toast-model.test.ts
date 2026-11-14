import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatConversation } from '../src/api/chat.ts'
import {
  activeEntryCount,
  CHAT_MUTE_OPTIONS,
  CHAT_TOAST_MAX,
  formatMuteUntil,
  handlerLabel,
  isMuteActive,
  isMuted,
  needsReply,
  removeLeavingEntry,
  selectToastConversations,
  syncToastEntries,
  type ChatToastEntry,
} from '../src/features/chat/chatToastModel.ts'

function conv(convId: string, extra: Partial<ChatConversation> = {}): ChatConversation {
  return {
    convId,
    kind: 'account',
    title: convId,
    online: true,
    lastText: 'xin chào',
    lastAt: 1000,
    lastId: 1,
    unread: 1,
    ...extra,
  }
}

const base = { dismissed: {}, viewingConvId: null, muted: false }

/** n hội thoại khác nhau, lastAt tăng dần (u1 cũ nhất). */
function many(n: number) {
  return Array.from({ length: n }, (_, i) => conv(`u${i + 1}`, { lastAt: 1000 + i, lastId: i + 1 }))
}

test('select: chỉ lấy hội thoại còn chưa đọc', () => {
  const out = selectToastConversations([conv('a'), conv('b', { unread: 0 })], base)
  assert.deepEqual(out.map((c) => c.convId), ['a'])
})

test('select: xếp cũ → mới theo lastAt (cũ nhất ở trên cùng)', () => {
  const out = selectToastConversations(
    [conv('moi', { lastAt: 300 }), conv('cu', { lastAt: 100 }), conv('giua', { lastAt: 200 })],
    base,
  )
  assert.deepEqual(out.map((c) => c.convId), ['cu', 'giua', 'moi'])
})

test('select: bấm X ẩn đến khi có tin MỚI hơn (lastId lớn hơn mốc đã ẩn)', () => {
  const dismissed = { a: 5 }
  assert.equal(selectToastConversations([conv('a', { lastId: 5 })], { ...base, dismissed }).length, 0)
  assert.equal(selectToastConversations([conv('a', { lastId: 4 })], { ...base, dismissed }).length, 0)
  assert.equal(selectToastConversations([conv('a', { lastId: 6 })], { ...base, dismissed }).length, 1)
  // hội thoại khác không bị ảnh hưởng
  assert.equal(selectToastConversations([conv('b', { lastId: 1 })], { ...base, dismissed }).length, 1)
})

test('select: đang mở đúng khung chat đó thì không toast', () => {
  const out = selectToastConversations([conv('a'), conv('b')], { ...base, viewingConvId: 'a' })
  assert.deepEqual(out.map((c) => c.convId), ['b'])
})

test('select: đang tạm tắt ⇒ rỗng', () => {
  assert.deepEqual(selectToastConversations([conv('a')], { ...base, muted: true }), [])
})

test('select: vượt 10 ⇒ giữ 10 toast MỚI nhất, bỏ cũ nhất', () => {
  const out = selectToastConversations(many(CHAT_TOAST_MAX + 3), base)
  assert.equal(out.length, CHAT_TOAST_MAX)
  assert.equal(out[0].convId, 'u4')
  assert.equal(out[out.length - 1].convId, 'u13')
})

test('select: đúng 10 thì không ai bị cắt; hạn mức tuỳ chỉnh', () => {
  assert.equal(selectToastConversations(many(CHAT_TOAST_MAX), base).length, CHAT_TOAST_MAX)
  assert.deepEqual(selectToastConversations(many(4), { ...base, max: 2 }).map((c) => c.convId), ['u3', 'u4'])
})

test('sync: danh sách rỗng + 3 mới ⇒ thêm đủ, không ai leaving', () => {
  const out = syncToastEntries([], many(3))
  assert.deepEqual(out.map((e) => [e.conversation.convId, e.leaving]), [
    ['u1', false],
    ['u2', false],
    ['u3', false],
  ])
})

test('sync: tin dồn vào toast cũ ⇒ cập nhật nội dung, GIỮ NGUYÊN vị trí (không nhảy chỗ)', () => {
  const first = syncToastEntries([], many(3))
  const updated = conv('u1', { lastText: 'tin mới', unread: 4, lastAt: 9999, lastId: 9 })
  const out = syncToastEntries(first, [many(3)[1], many(3)[2], updated])
  assert.deepEqual(out.map((e) => e.conversation.convId), ['u1', 'u2', 'u3'])
  assert.equal(out[0].conversation.unread, 4)
  assert.equal(out[0].conversation.lastText, 'tin mới')
})

test('sync: hội thoại biến mất khỏi danh sách (đã đọc / bấm X / tạm tắt) ⇒ leaving, chưa gỡ', () => {
  const first = syncToastEntries([], many(3))
  const out = syncToastEntries(first, [many(3)[0], many(3)[2]])
  assert.equal(out.length, 3)
  assert.equal(out[1].leaving, true)
  assert.equal(activeEntryCount(out), 2)
})

test('sync: không có gì đổi ⇒ trả đúng mảng cũ (tránh render thừa)', () => {
  const desired = many(3)
  const first = syncToastEntries([], desired)
  assert.equal(syncToastEntries(first, desired), first)
})

test('sync: toast đang rời mà quay lại (có tin mới) ⇒ hồi sinh tại chỗ, không tạo bản trùng', () => {
  const first = syncToastEntries([], many(2))
  const leaving = syncToastEntries(first, [many(2)[1]])
  assert.equal(leaving[0].leaving, true)
  const back = syncToastEntries(leaving, [conv('u1', { lastId: 50, lastAt: 5000 }), many(2)[1]])
  assert.equal(back.length, 2)
  assert.equal(back[0].leaving, false)
  assert.equal(back[0].conversation.lastId, 50)
})

test('sync: vượt 10 ⇒ toast cũ nhất rời có hiệu ứng, còn đúng 10 đang hiện, toast mới vào cuối', () => {
  const ten = syncToastEntries([], selectToastConversations(many(CHAT_TOAST_MAX), base))
  const eleven = syncToastEntries(ten, selectToastConversations(many(CHAT_TOAST_MAX + 1), base))
  assert.equal(eleven.length, CHAT_TOAST_MAX + 1)
  assert.equal(eleven[0].conversation.convId, 'u1')
  assert.equal(eleven[0].leaving, true)
  assert.equal(activeEntryCount(eleven), CHAT_TOAST_MAX)
  assert.equal(eleven[eleven.length - 1].conversation.convId, 'u11')
  assert.ok(eleven.slice(1).every((e) => !e.leaving))
})

test('sync: dồn dập 15 toast từng bước ⇒ luôn ≤ 10 đang hiện, bị đẩy theo thứ tự cũ → mới', () => {
  let entries: ChatToastEntry[] = []
  for (let n = 1; n <= 15; n++) {
    entries = syncToastEntries(entries, selectToastConversations(many(n), base))
    assert.ok(activeEntryCount(entries) <= CHAT_TOAST_MAX)
  }
  assert.deepEqual(
    entries.filter((e) => e.leaving).map((e) => e.conversation.convId),
    ['u1', 'u2', 'u3', 'u4', 'u5'],
  )
})

test('removeLeavingEntry: chỉ gỡ toast vẫn đang rời; đã hồi sinh thì giữ', () => {
  const first = syncToastEntries([], many(2))
  const leaving = syncToastEntries(first, [many(2)[1]])
  assert.deepEqual(removeLeavingEntry(leaving, 'u1').map((e) => e.conversation.convId), ['u2'])
  const revived = syncToastEntries(leaving, many(2))
  assert.equal(removeLeavingEntry(revived, 'u1'), revived)
  assert.equal(removeLeavingEntry(revived, 'khong-co'), revived)
})

test('mute: tuỳ chọn 15 phút + 1 tiếng; isMuted theo mốc', () => {
  assert.deepEqual(CHAT_MUTE_OPTIONS.map((o) => [o.label, o.ms]), [
    ['15 phút', 900_000],
    ['1 tiếng', 3_600_000],
  ])
  assert.equal(isMuted(null, 100), false)
  assert.equal(isMuted(200, 100), true)
  assert.equal(isMuted(100, 100), false) // đúng mốc ⇒ đã hết
  assert.equal(isMuted(50, 100), false)
})

// ---- C11: server có `lastDir` (khách chờ phản hồi) + nhân viên đang xử lý ----

/** Hội thoại từ server C11b: `lastDir` + (tuỳ chọn) người đã đọc. unread mặc định 0 vì người đọc đã đẩy con trỏ. */
function awaiting(convId: string, extra: Partial<ChatConversation> = {}): ChatConversation {
  return conv(convId, { lastDir: 2, unread: 0, lastAt: 1000, lastId: 5, ...extra })
}

test('needsReply: có lastDir ⇒ theo lastDir (đã đọc vẫn chờ); không có lastDir ⇒ theo chưa đọc (server cũ)', () => {
  assert.equal(needsReply({ lastDir: 2, unread: 0 }), true)
  assert.equal(needsReply({ lastDir: 1, unread: 3 }), false) // đã có người trả lời dù còn "chưa đọc"
  assert.equal(needsReply({ unread: 2 }), true)
  assert.equal(needsReply({ unread: 0 }), false)
})

test('select (C11): đã có người đọc (unread 0) nhưng chưa trả lời ⇒ toast VẪN hiện', () => {
  const out = selectToastConversations([awaiting('a', { readByName: 'Lan', readByStaffId: 7, readAt: 1500 })], base)
  assert.deepEqual(out.map((c) => c.convId), ['a'])
})

test('select (C11): đã có người trả lời (lastDir 1) ⇒ ẩn ở mọi session', () => {
  assert.deepEqual(selectToastConversations([awaiting('a', { lastDir: 1, unread: 4 })], base), [])
})

test('select (C11): chính tôi là người đọc ⇒ không toast lại cho tôi; người khác đọc ⇒ vẫn hiện', () => {
  const read = awaiting('a', { readByName: 'Lan', readByStaffId: 7, readAt: 1500 })
  assert.equal(selectToastConversations([read], { ...base, selfStaffId: 7 }).length, 0)
  assert.equal(selectToastConversations([read], { ...base, selfStaffId: 9 }).length, 1)
  assert.equal(selectToastConversations([read], { ...base, selfStaffId: null }).length, 1)
  assert.equal(selectToastConversations([read], { ...base, selfStaffId: 0 }).length, 1) // sysadmin: không phân biệt được
  // khách nhắn thêm SAU lần đọc của tôi ⇒ tin mới tôi chưa thấy ⇒ toast hiện lại
  const newer = { ...read, lastAt: 2000, lastId: 6 }
  assert.equal(selectToastConversations([newer], { ...base, selfStaffId: 7 }).length, 1)
})

test('handlerLabel: tên người KHÁC đã đọc tin cuối; không có/quá cũ/chính mình ⇒ null', () => {
  const read = awaiting('a', { readByName: 'Lan', readByStaffId: 7, readAt: 1500 })
  assert.equal(handlerLabel(read, 9), 'Lan')
  assert.equal(handlerLabel(read, null), 'Lan')
  assert.equal(handlerLabel(read, 7), null) // chính mình
  assert.equal(handlerLabel(awaiting('b'), 9), null) // chưa ai đọc
  assert.equal(handlerLabel({ ...read, lastAt: 2000 }, 9), null) // khách nhắn sau lần đọc ⇒ chưa ai thấy tin mới
  assert.equal(handlerLabel({ ...read, readByName: '  ' }, 9), null)
  assert.equal(handlerLabel({ ...read, readAt: undefined }, 9), null)
})

test('isMuteActive: chỉ hiệu lực trong đúng phiên đăng nhập đã bấm và còn hạn', () => {
  assert.equal(isMuteActive(200, 's1', 's1', 100), true)
  assert.equal(isMuteActive(200, 's1', 's2', 100), false) // đổi tài khoản / phiên khác
  assert.equal(isMuteActive(200, 's1', null, 100), false) // đã đăng xuất
  assert.equal(isMuteActive(200, null, 's1', 100), false)
  assert.equal(isMuteActive(100, 's1', 's1', 100), false) // hết hạn
  assert.equal(isMuteActive(null, 's1', 's1', 100), false)
})

test('formatMuteUntil: HH:mm có đệm 0', () => {
  const ts = new Date(2026, 10, 14, 9, 5, 30).getTime()
  assert.equal(formatMuteUntil(ts), '09:05')
})
