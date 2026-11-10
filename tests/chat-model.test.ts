import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatConversation, ChatMessage } from '../src/api/chat.ts'
import {
  badgeText,
  buildTimeline,
  cardOf,
  checkDraft,
  conversationMatches,
  conversationTag,
  countCodePoints,
  describeChatSettingsError,
  formatChatTime,
  insertAtSelection,
  isOwnMessage,
  latestInboundId,
  mergeMessages,
  newClientMsgId,
  normalizeDraft,
  searchSuggestions,
  senderLabel,
  sessionKey,
  validateChatRetention,
} from '../src/features/chat/chatModel.ts'

function msg(partial: Partial<ChatMessage> & { id: number }): ChatMessage {
  return {
    ts: 1_700_000_000_000 + partial.id,
    dir: 2,
    ch: 2,
    src: 4,
    host: 'PC-05',
    kind: 'chat',
    meta: null,
    staffId: 0,
    staffName: '',
    user: 'khach1',
    uid: 7,
    utype: 'member',
    sess: 100,
    text: 'xin chao',
    ...partial,
  }
}

test('countCodePoints: emoji ngoai BMP = 1, khop cach server dem (byte dau UTF-8)', () => {
  assert.equal(countCodePoints('abc'), 3)
  assert.equal(countCodePoints('😀'), 1)
  assert.equal(countCodePoints('Việt Nam'), 8)
  assert.equal(countCodePoints('😀'.repeat(1000)), 1000)
})

test('normalizeDraft: CRLF->LF, bo ky tu dieu khien tru \\n, trim, <=3 dong trong', () => {
  assert.equal(normalizeDraft('  a\r\nb\rc  '), 'a\nb\nc')
  assert.equal(normalizeDraft('a\u0000b\u0007c\td'), 'abcd') // \t cung la ky tu dieu khien, bi bo
  // Giống server (chat_text.cpp): >3 dong trong => gom ve 2; <=3 giu nguyen.
  assert.equal(normalizeDraft('a\n\n\n\n\n\n\nb'), 'a\n\n\nb')
  assert.equal(normalizeDraft('a\n\n\n\n\nb'), 'a\n\n\nb') // dung 4 dong trong => 2
  assert.equal(normalizeDraft('a\n\n\n\nb'), 'a\n\n\n\nb') // dung 3 dong trong => giu
  assert.equal(normalizeDraft('a﻿b'), 'ab')
  assert.equal(normalizeDraft('a\n\n\nb'), 'a\n\n\nb')
  assert.equal(normalizeDraft('   \n  '), '')
})

test('checkDraft: rong / qua 1000 code point / hop le', () => {
  assert.deepEqual(checkDraft('   '), { ok: false, reason: 'empty', text: '', length: 0 })
  const tooLong = checkDraft('a'.repeat(1001))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.ok === false && tooLong.reason, 'too_long')
  const exactly = checkDraft('😀'.repeat(1000))
  assert.equal(exactly.ok, true)
  assert.equal(checkDraft(' hi ').ok && checkDraft(' hi ').text, 'hi')
})

test('isOwnMessage: chi tin nhan vien NAY gon tu fnet-web (src=2) moi nam ben phai', () => {
  assert.equal(isOwnMessage({ dir: 1, src: 2, staffId: 5 }, 5), true)
  assert.equal(isOwnMessage({ dir: 1, src: 2, staffId: 6 }, 5), false) // nhan vien khac
  assert.equal(isOwnMessage({ dir: 1, src: 1, staffId: 0 }, 5), false) // thu ngan MFC
  assert.equal(isOwnMessage({ dir: 1, src: 1, staffId: 0 }, 0), false)
  assert.equal(isOwnMessage({ dir: 2, src: 4, staffId: 5 }, 5), false) // tin khach
  assert.equal(isOwnMessage({ dir: 1, src: 2, staffId: 5 }, null), false)
})

test('senderLabel: khach lay ten tai khoan/may, nhan vien lay staffName', () => {
  assert.equal(senderLabel(msg({ id: 1 })), 'khach1')
  assert.equal(senderLabel(msg({ id: 1, user: '', host: 'PC-09' })), 'PC-09')
  assert.equal(senderLabel(msg({ id: 1, dir: 1, src: 1, staffName: 'Lan' })), 'Lan')
  assert.equal(senderLabel(msg({ id: 1, dir: 1, src: 1, staffName: '' })), 'Thu ngân')
})

test('mergeMessages: bo trung theo id, sap tang dan', () => {
  const merged = mergeMessages([msg({ id: 3 }), msg({ id: 1 })], [msg({ id: 2 }), msg({ id: 3, text: 'moi' })])
  assert.deepEqual(merged.map((m) => m.id), [1, 2, 3])
  assert.equal(merged[2].text, 'moi')
})

test('buildTimeline: vach phien khi doi sess/may, vach Tin moi truoc tin khach dau tien chua doc', () => {
  const now = 1_700_000_100_000
  const items = [
    msg({ id: 1, sess: 100 }),
    msg({ id: 2, sess: 100, dir: 1, src: 2, staffId: 5 }),
    msg({ id: 3, sess: 200, host: 'PC-09' }),
    msg({ id: 4, sess: 200, host: 'PC-09' }),
  ]
  const tl = buildTimeline(items, 2, now)
  assert.deepEqual(
    tl.map((e) => e.type),
    ['session', 'message', 'message', 'session', 'unread', 'message', 'message'],
  )
  // tat ca da doc => khong co vach Tin moi
  assert.equal(buildTimeline(items, 4, now).some((e) => e.type === 'unread'), false)
  // tin nhan vien gui (dir=1) co id > staffRead KHONG tinh la chua doc
  assert.equal(buildTimeline([msg({ id: 9, dir: 1, src: 2, staffId: 5 })], 0, now).some((e) => e.type === 'unread'), false)
})

test('sessionKey: co sess thi theo sess, khong thi theo may', () => {
  assert.equal(sessionKey({ sess: 5, host: 'PC' }), 's5')
  assert.equal(sessionKey({ sess: 0, host: 'PC-01' }), 'hPC-01')
})

test('latestInboundId: chi tin khach', () => {
  assert.equal(latestInboundId([msg({ id: 1 }), msg({ id: 5, dir: 1, src: 2 }), msg({ id: 3 })]), 3)
  assert.equal(latestInboundId([msg({ id: 5, dir: 1, src: 2 })]), 0)
})

test('cardOf: the lenh chi dung khi du meta; chat thuong va meta hong => null', () => {
  assert.equal(cardOf({ kind: 'chat', meta: null }), null)
  const cash = cardOf({ kind: 'cash_request', meta: { amount: 20000 } })
  assert.equal(cash?.title, 'Khách nhờ nạp tiền mặt')
  assert.equal(cash?.amount, 20000)
  assert.equal(cardOf({ kind: 'cash_request', meta: null }), null)
  assert.equal(cardOf({ kind: 'online_request', meta: { amount: 'abc' } }), null)
  assert.equal(cardOf({ kind: 'order_check', meta: { amount: 50000 } }), null) // thieu orderId
  const order = cardOf({ kind: 'order_check', meta: { amount: 50000, orderId: 'FN123' } })
  assert.equal(order?.orderId, 'FN123')
  // kind la tu server cu/du lieu la
  assert.equal(cardOf({ kind: 'weird' as never, meta: { amount: 1 } }), null)
})

test('formatChatTime: hom nay chi gio, hom qua, ngay khac', () => {
  const now = new Date(2026, 10, 9, 14, 30).getTime()
  assert.equal(formatChatTime(new Date(2026, 10, 9, 9, 5).getTime(), now), '09:05')
  assert.equal(formatChatTime(new Date(2026, 10, 8, 20, 15).getTime(), now), '20:15 hôm qua')
  assert.equal(formatChatTime(new Date(2026, 10, 1, 8, 0).getTime(), now), '08:00 01/11')
  assert.equal(formatChatTime(new Date(2025, 11, 31, 8, 0).getTime(), now), '08:00 31/12/2025')
})

test('conversationMatches: khong phan biet hoa thuong va dau tieng Viet', () => {
  const conv: ChatConversation = {
    convId: 'u12',
    kind: 'account',
    title: 'Nguyễn Văn Đạt',
    hostName: 'PC-07',
    online: true,
    lastText: 'Cho em nạp tiền',
    lastAt: 1,
    lastId: 1,
    unread: 0,
  }
  assert.equal(conversationMatches(conv, ''), true)
  assert.equal(conversationMatches(conv, 'dat'), true)
  assert.equal(conversationMatches(conv, 'nap tien'), true)
  assert.equal(conversationMatches(conv, 'pc-07'), true)
  assert.equal(conversationMatches(conv, 'xyz'), false)
  // Theo truong (giong o tim trang May tram)
  assert.equal(conversationMatches(conv, 'dat', 'user'), true)
  assert.equal(conversationMatches(conv, 'pc-07', 'user'), false)
  assert.equal(conversationMatches(conv, 'pc-07', 'pc'), true)
  assert.equal(conversationMatches(conv, 'nap', 'pc'), false)
  assert.equal(conversationMatches(conv, 'nap tien', 'text'), true)
  assert.equal(conversationMatches(conv, 'dat', 'text'), false)
  // Khach vang lai dat ten theo may: tim theo May cung khop title
  const guest: ChatConversation = { ...conv, convId: 'gPC-09', kind: 'host', title: 'PC-09', hostName: undefined }
  assert.equal(conversationMatches(guest, 'pc-09', 'pc'), true)
  assert.equal(conversationMatches(guest, 'pc-09', 'user'), true)
})

test('searchSuggestions + conversationTag', () => {
  const account: ChatConversation = {
    convId: 'u1', kind: 'account', title: 'HV1', hostName: 'PC-01', online: true, lastText: '', lastAt: 0, lastId: 0, unread: 0,
  }
  const offline: ChatConversation = { ...account, convId: 'u2', title: 'HV2', hostName: undefined, online: false }
  const guest: ChatConversation = { ...account, convId: 'gPC-09', kind: 'host', title: 'PC-09', hostName: undefined }
  assert.deepEqual(searchSuggestions([account, offline, guest, account], 'user'), ['HV1', 'HV2'])
  assert.deepEqual(searchSuggestions([account, offline, guest], 'pc'), ['PC-01', 'PC-09'])
  assert.deepEqual(searchSuggestions([account], 'text'), [])
  assert.equal(conversationTag(account), 'PC-01')
  assert.equal(conversationTag(offline), '')
  assert.equal(conversationTag(guest), 'Khách vãng lai')
})

test('badgeText: 0 an, >99 thanh 99+', () => {
  assert.equal(badgeText(0), '')
  assert.equal(badgeText(-1), '')
  assert.equal(badgeText(7), '7')
  assert.equal(badgeText(100), '99+')
})

test('insertAtSelection: chen tai con tro / thay vung chon / kep bien', () => {
  assert.deepEqual(insertAtSelection('abcd', 'X', 2, 2), { text: 'abXcd', cursor: 3 })
  assert.deepEqual(insertAtSelection('abcd', '😀', 1, 3), { text: 'a😀d', cursor: 3 })
  assert.deepEqual(insertAtSelection('ab', '\n', 99, 99), { text: 'ab\n', cursor: 3 })
})

test('newClientMsgId: dung dinh dang server (^[A-Za-z0-9_.:-]{1,64}$)', () => {
  const id = newClientMsgId()
  assert.match(id, /^[A-Za-z0-9_.:-]{1,64}$/)
  assert.notEqual(newClientMsgId(() => 0.1, 1), newClientMsgId(() => 0.2, 1))
})

test('validateChatRetention + describeChatSettingsError', () => {
  assert.equal(validateChatRetention(false, 9999), null) // tat tu xoa => bo qua so ngay
  assert.equal(validateChatRetention(true, 30), null)
  assert.notEqual(validateChatRetention(true, 0), null)
  assert.notEqual(validateChatRetention(true, 366), null)
  assert.notEqual(validateChatRetention(true, 1.5), null)
  assert.match(describeChatSettingsError('storagePath invalid: network_drive'), /ổ cục bộ/)
  assert.match(describeChatSettingsError('storagePath not usable: write_failed'), /write_failed/)
  assert.equal(describeChatSettingsError('boom'), 'boom')
})
