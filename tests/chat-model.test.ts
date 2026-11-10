import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatConversation, ChatMessage } from '../src/api/chat.ts'
import {
  applyReactionRequest,
  badgeText,
  buildTimeline,
  canReact,
  canReply,
  cardOf,
  checkDraft,
  chipLabel,
  conversationMatches,
  conversationTag,
  countCodePoints,
  describeChatError,
  describeChatSettingsError,
  detectBurst,
  formatChatTime,
  formatCountdown,
  groupTimeline,
  insertAtSelection,
  isOwnMessage,
  latestInboundId,
  mergeMessages,
  myReactionTotal,
  newClientMsgId,
  normalizeDraft,
  reactionChips,
  reactionRequestFor,
  remainingLockSec,
  replyOf,
  replyWho,
  retryAfterSecOf,
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

test('groupTimeline: gom tin gan nhau cua cung nguoi vao 1 bong bong, ngat dung cho', () => {
  const now = 1_700_000_100_000
  const T = 1_700_000_000_000
  const guest = (id: number, dt: number, extra: Partial<ChatMessage> = {}) => msg({ id, ts: T + dt, ...extra })
  const mine = (id: number, dt: number) => msg({ id, ts: T + dt, dir: 1, src: 2, staffId: 5, staffName: 'A' })
  const groups = (items: ChatMessage[], staffRead = 999_999_999_999_999) =>
    groupTimeline(buildTimeline(items, staffRead, now), 5).filter((e) => e.type === 'group')

  // 3 tin khach lien tiep trong 2 phut => 1 nhom; chuoi go lien tuc (moi tin cach <=2 phut) van dinh nhau
  const g1 = groups([guest(1, 0), guest(2, 60_000), guest(3, 170_000)])
  assert.equal(g1.length, 1)
  assert.deepEqual(g1[0].type === 'group' && g1[0].messages.map((m) => m.id), [1, 2, 3])
  assert.equal(g1[0].type === 'group' && g1[0].key, 'group-1') // key theo tin dau => on dinh khi them tin

  // cach >2 phut => tach
  assert.equal(groups([guest(1, 0), guest(2, 121_000)]).length, 2)
  // doi nguoi gui => tach; tin cua toi ben phai
  const g3 = groups([guest(1, 0), mine(2, 1_000), guest(3, 2_000)])
  assert.deepEqual(g3.map((g) => g.type === 'group' && g.own), [false, true, false])
  // 2 nhan vien khac nhau khong gop chung
  const other = msg({ id: 4, ts: T + 3_000, dir: 1, src: 2, staffId: 6, staffName: 'B' })
  assert.equal(groups([mine(1, 0), other]).length, 2)
  // vach "Tin moi" va doi phien ngat nhom du cung nguoi, gan nhau
  assert.equal(groups([guest(1, 0), guest(2, 1_000)], 1).length, 2) // staffRead=1 => vach Tin moi truoc tin 2
  assert.equal(groups([guest(1, 0, { sess: 1 }), guest(2, 1_000, { sess: 2 })]).length, 2)
})

test('groupTimeline: bong bong ke tiep cua cung nguoi danh dau continued (UI khong lap ten)', () => {
  const T = 1_700_000_000_000
  const gap = 121_000
  const flags = (items: ChatMessage[], staffRead = 999_999_999_999_999) =>
    groupTimeline(buildTimeline(items, staffRead, T), 5).flatMap((e) => (e.type === 'group' ? [e.continued] : []))
  const g = (id: number, dt: number, extra: Partial<ChatMessage> = {}) => msg({ id, ts: T + dt, ...extra })
  // cung nguoi, cach >2 phut: bong bong 1 co ten, 2 va 3 chi noi dung
  assert.deepEqual(flags([g(1, 0), g(2, gap), g(3, gap * 2)]), [false, true, true])
  // doi nguoi => co ten lai
  assert.deepEqual(
    flags([g(1, 0), msg({ id: 2, ts: T + gap, dir: 1, src: 2, staffId: 5 }), g(3, gap * 2)]),
    [false, false, false],
  )
  // co vach (doi phien / Tin moi) xen giua => hien ten lai
  assert.deepEqual(flags([g(1, 0, { sess: 1 }), g(2, gap, { sess: 2 })]), [false, false])
  assert.deepEqual(flags([g(1, 0), g(2, gap)], 1), [false, false])
  // the lenh xen giua => hien ten lai
  const card = msg({ id: 2, ts: T + 1_000, kind: 'cash_request', meta: { amount: 1 }, src: 3 })
  assert.deepEqual(flags([g(1, 0), card, g(3, 2_000)]), [false, false])
})

test('groupTimeline: the lenh khong gop vao bong bong va ngat nhom', () => {
  const T = 1_700_000_000_000
  const card = msg({ id: 2, ts: T + 1_000, kind: 'cash_request', meta: { amount: 20000 }, src: 3 })
  const out = groupTimeline(buildTimeline([msg({ id: 1, ts: T }), card, msg({ id: 3, ts: T + 2_000 })], 999_999_999_999_999, T), 5)
  assert.deepEqual(out.map((e) => e.type), ['session', 'group', 'card', 'group'])
  // the lenh hong (thieu meta) => hien nhu tin chat thuong, gop nhom duoc
  const broken = msg({ id: 2, ts: T + 1_000, kind: 'cash_request', meta: null })
  const out2 = groupTimeline(buildTimeline([msg({ id: 1, ts: T }), broken], 999_999_999_999_999, T), 5)
  assert.equal(out2.filter((e) => e.type === 'group').length, 1)
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
  assert.equal(conversationTag(guest), 'Khách vãng lai & combo')
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

// ---- task chat-C9: phan ung, tra loi, khoa chong don tin ---------------------------------------------------

test('reactionChips: thu tu co dinh tim/like/cuoi, bo n<=0 va so hong', () => {
  assert.deepEqual(reactionChips(undefined), [])
  assert.deepEqual(reactionChips({}), [])
  const chips = reactionChips({ laugh: { n: 2, mine: 0 }, heart: { n: 7, mine: 3 }, thumb: { n: 0, mine: 0 } })
  assert.deepEqual(chips.map((c) => [c.kind, c.n, c.mine]), [['heart', 7, 3], ['laugh', 2, 0]])
  // mine khong duoc vuot n; so am / NaN bi bo
  assert.equal(reactionChips({ heart: { n: 2, mine: 9 } })[0].mine, 2)
  assert.deepEqual(reactionChips({ heart: { n: -1, mine: 0 }, thumb: { n: Number.NaN, mine: 0 } }), [])
})

test('myReactionTotal + chipLabel', () => {
  assert.equal(myReactionTotal({ heart: { n: 7, mine: 3 }, thumb: { n: 1, mine: 1 } }), 4)
  assert.equal(myReactionTotal(undefined), 0)
  assert.equal(chipLabel({ kind: 'heart', emoji: '❤️', n: 7, mine: 2 }), 'Thả tim: 7 (bạn 2)')
  assert.equal(chipLabel({ kind: 'thumb', emoji: '👍', n: 1, mine: 0 }), 'Thích: 1')
})

test('reactionRequestFor: tim +1 toi tran 10; like/cuoi bat-tat; xoa chi khi co phan ung cua toi', () => {
  assert.deepEqual(reactionRequestFor(undefined, 'heart'), { emoji: 'heart', count: 1 })
  assert.deepEqual(reactionRequestFor({ heart: { n: 9, mine: 4 } }, 'heart'), { emoji: 'heart', count: 5 })
  assert.equal(reactionRequestFor({ heart: { n: 12, mine: 10 } }, 'heart'), null) // tran 10
  assert.deepEqual(reactionRequestFor(undefined, 'thumb'), { emoji: 'thumb', count: 1 })
  assert.deepEqual(reactionRequestFor({ thumb: { n: 3, mine: 1 } }, 'thumb'), { emoji: 'thumb', count: 0 }) // bam lai = bo
  assert.deepEqual(reactionRequestFor({ thumb: { n: 3, mine: 0 } }, 'thumb'), { emoji: 'thumb', count: 1 }) // nguoi khac thich, minh chua
  assert.deepEqual(reactionRequestFor({ laugh: { n: 1, mine: 1 } }, 'laugh'), { emoji: 'laugh', count: 0 })
  assert.equal(reactionRequestFor({ heart: { n: 5, mine: 0 } }, 'clear'), null) // chua tha gi => khong co gi de xoa
  assert.deepEqual(reactionRequestFor({ heart: { n: 5, mine: 2 } }, 'clear'), { emoji: 'all', count: 0 })
})

test('applyReactionRequest: lac quan khop luat server, khong doi ban goc', () => {
  const base = { heart: { n: 7, mine: 2 }, thumb: { n: 1, mine: 1 } }
  const snapshot = JSON.stringify(base)
  assert.deepEqual(applyReactionRequest(base, { emoji: 'heart', count: 3 }), { heart: { n: 8, mine: 3 }, thumb: { n: 1, mine: 1 } })
  assert.deepEqual(applyReactionRequest(base, { emoji: 'thumb', count: 0 }), { heart: { n: 7, mine: 2 } }) // n ve 0 => bo khoa
  assert.deepEqual(applyReactionRequest(base, { emoji: 'all', count: 0 }), { heart: { n: 5, mine: 0 } }) // chi tru phan cua toi
  assert.deepEqual(applyReactionRequest(undefined, { emoji: 'laugh', count: 1 }), { laugh: { n: 1, mine: 1 } })
  assert.deepEqual(applyReactionRequest({}, { emoji: 'all', count: 0 }), {})
  assert.equal(JSON.stringify(base), snapshot)
})

test('thao tac lien tiep tinh theo trang thai lac quan (bam tim nhieu lan)', () => {
  let state: Parameters<typeof reactionChips>[0] = {}
  const sent: number[] = []
  for (let i = 0; i < 12; i += 1) {
    const req = reactionRequestFor(state, 'heart')
    if (!req) break
    sent.push(req.count)
    state = applyReactionRequest(state, req)
  }
  assert.deepEqual(sent, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) // dung o tran 10, moi lan gui SO TUYET DOI
  assert.deepEqual(state, { heart: { n: 10, mine: 10 } })
})

test('mergeMessages: tin da tai truoc do duoc cap nhat reactions tu ban moi nhat', () => {
  const old = msg({ id: 10, reactions: { heart: { n: 1, mine: 0 } } })
  const fresh = msg({ id: 10, reactions: { heart: { n: 4, mine: 2 } } })
  const merged = mergeMessages([old, msg({ id: 5 })], [fresh])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[1].reactions, { heart: { n: 4, mine: 2 } })
})

test('replyOf: doc meta.replyTo hop le; thieu/hong => null', () => {
  assert.equal(replyOf(msg({ id: 1 })), null)
  assert.equal(replyOf(msg({ id: 1, meta: { amount: 5 } })), null)
  assert.equal(replyOf(msg({ id: 1, meta: { replyTo: 'x' } })), null)
  assert.equal(replyOf(msg({ id: 1, meta: { replyTo: { id: 0, who: 'a', text: 'b' } } })), null)
  assert.deepEqual(replyOf(msg({ id: 1, meta: { replyTo: { id: 99, dir: 1, who: 'Lan', text: 'chao ban' } } })), {
    id: 99,
    dir: 1,
    who: 'Lan',
    text: 'chao ban',
  })
  // thieu field => mac dinh an toan
  assert.deepEqual(replyOf(msg({ id: 1, meta: { replyTo: { id: 7 } } })), { id: 7, dir: 2, who: '', text: '' })
  assert.equal(replyWho({ dir: 2, who: '' }), 'Khách')
  assert.equal(replyWho({ dir: 1, who: '' }), 'Thu ngân')
  assert.equal(replyWho({ dir: 1, who: 'Lan' }), 'Lan')
})

test('canReact / canReply: thieu caps (Server cu) => an', () => {
  assert.equal(canReact(undefined), false)
  assert.equal(canReply(undefined), false)
  assert.equal(canReact({}), false)
  assert.equal(canReact({ react: true }), true)
  assert.equal(canReply({ react: true }), false)
  assert.equal(canReply({ reply: true }), true)
})

test('detectBurst: lan gui thu 3 trong 1 s bi khoa; 2 lan/giay thi khong', () => {
  let h: number[] = []
  let r = detectBurst(h, 1000)
  assert.equal(r.burst, false)
  h = r.history
  r = detectBurst(h, 1100)
  assert.equal(r.burst, false)
  h = r.history
  r = detectBurst(h, 1200) // lan thu 3 trong 200 ms
  assert.equal(r.burst, true)
  assert.deepEqual(r.history, []) // sau khoa xoa lich su

  // cach deu 550 ms: khong bao gio du 3 lan trong 1 s
  h = []
  let blocked = false
  for (let i = 0; i < 40; i += 1) {
    const res = detectBurst(h, i * 550)
    h = res.history
    blocked = blocked || res.burst
  }
  assert.equal(blocked, false)

  // dung bien: tin 1 cach tin 3 dung 1000 ms => da roi cua so (khop server: now - t >= 1000)
  r = detectBurst(detectBurst(detectBurst([], 0).history, 500).history, 1000)
  assert.equal(r.burst, false)
  r = detectBurst(detectBurst(detectBurst([], 0).history, 500).history, 999)
  assert.equal(r.burst, true)
})

test('retryAfterSecOf: chi BURST_LOCKED/RATE_LIMITED, doc object hoac chuoi JSON, lam tron len', () => {
  assert.equal(retryAfterSecOf('BURST_LOCKED', { retryAfterSec: 58 }), 58)
  assert.equal(retryAfterSecOf('RATE_LIMITED', { retryAfterSec: 59.2 }), 60)
  assert.equal(retryAfterSecOf('BURST_LOCKED', '{"retryAfterSec":120}'), 120)
  assert.equal(retryAfterSecOf('BURST_LOCKED', 'khong phai json'), null)
  assert.equal(retryAfterSecOf('BURST_LOCKED', undefined), null)
  assert.equal(retryAfterSecOf('BURST_LOCKED', { retryAfterSec: 0 }), null)
  assert.equal(retryAfterSecOf('BURST_LOCKED', { retryAfterSec: 'abc' }), null)
  assert.equal(retryAfterSecOf('store_error', { retryAfterSec: 30 }), null)
})

test('remainingLockSec + formatCountdown', () => {
  assert.equal(remainingLockSec(0, 5000), 0)
  assert.equal(remainingLockSec(5000, 5000), 0)
  assert.equal(remainingLockSec(65_000, 5000), 60)
  assert.equal(remainingLockSec(5001, 5000), 1) // lam tron len
  assert.equal(formatCountdown(180), '3:00')
  assert.equal(formatCountdown(61), '1:01')
  assert.equal(formatCountdown(0), '0:00')
  assert.equal(formatCountdown(-5), '0:00')
})

test('describeChatError: ma loi moi cua C8 ra tieng Viet', () => {
  for (const code of ['BURST_LOCKED', 'RATE_LIMITED', 'REACT_LIMIT', 'REACT_TARGET_NOT_FOUND', 'REACT_TARGET_EXPIRED', 'REPLY_TARGET_NOT_FOUND']) {
    const text = describeChatError(code)
    assert.notEqual(text, code)
    assert.match(text, /[a-zà-ỹ]/i)
  }
  assert.equal(describeChatError('mot loi la'), 'mot loi la') // khong khop => giu nguyen
})
test('describeChatError: loi validate cua server => cau chung tieng Viet, khong de nguyen tieng Anh', () => {
  for (const code of ['count invalid', 'targetId invalid', 'replyToId invalid', 'react_invalid', 'emoji invalid (heart|thumb|laugh|all)']) {
    assert.equal(describeChatError(code), 'Yêu cầu không hợp lệ.')
  }
  assert.equal(describeChatError('convId invalid'), 'Hội thoại không hợp lệ.') // da co cau rieng
  assert.equal(describeChatError('invalid_utf8'), 'Tin nhắn chứa ký tự không hợp lệ.')
})