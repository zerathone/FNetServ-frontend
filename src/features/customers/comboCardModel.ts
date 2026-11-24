// Danh sách thẻ combo (tab "Thẻ Combo") — logic THUẦN, parity cột/dữ liệu với MFC `ComboCardList`
// (test: tests/combo-card-model.test.ts).
//
// MFC (ServerSide_ai/ComboCardList.cpp AddRowToList) hiển thị:
//   Thời hạn sử dụng  = "fromDate fromTime -> toDate toTime"
//   Thời điểm sử dụng = "fromTime -> toTime"
// Ý nghĩa đã đối chiếu code server (DAOComboCard::check_apply_time): với thẻ loại "Thời điểm" thì
// fromTime/toTime LÀ khung giờ được dùng trong ngày; from == to rơi vào nhánh "qua đêm" và luôn đúng ⇒ dùng cả ngày.
import type { ComboCardRow, UserAccount } from '../../api/users'

export type ComboCardSortKey = 'userName' | 'zone' | 'validity' | 'timeRange' | 'note'

export type ComboCardColumn = { id: ComboCardSortKey; label: string; width: string }

/** Thứ tự cột như MFC (bỏ cột "Thời điểm cập nhật" ở đầu vì MFC đang để ẩn). Nhãn lấy đúng chuỗi MFC. */
export const COMBO_CARD_COLUMNS: readonly ComboCardColumn[] = [
  { id: 'userName', label: 'Tên đăng nhập', width: 'minmax(13rem, 1.3fr)' },
  { id: 'zone', label: 'Máy', width: 'minmax(11rem, 1fr)' },
  { id: 'validity', label: 'Thời hạn sử dụng', width: 'minmax(18rem, 1.7fr)' },
  { id: 'timeRange', label: 'Thời điểm sử dụng', width: 'minmax(10rem, 0.9fr)' },
  { id: 'note', label: 'Ghi chú', width: 'minmax(10rem, 1.2fr)' },
]

/** "18:30:00" | "18:30" → "18:30"; rỗng/không đúng dạng giờ → ''. */
export function normalizeHm(value: string | undefined | null): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((value ?? '').trim())
  if (!match) return ''
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

/** "2026-11-23" → "23/11/2026". Không đúng dạng ⇒ '' (không in rác như "0000-00-00"). */
export function formatDmy(value: string | undefined | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? '').trim())
  if (!match || match[1] === '0000') return ''
  return `${match[3]}/${match[2]}/${match[1]}`
}

export type ComboEdge = { date: string; time: string }
export type ComboValidity = { from: ComboEdge; to: ComboEdge; text: string }

/**
 * Mốc bắt đầu → mốc kết thúc của thẻ. `null` khi thiếu cả hai ngày (hiển thị "—").
 * `text` = chuỗi thuần cho tooltip / đọc màn hình, cùng dạng MFC nhưng ngày theo dd/MM/yyyy.
 */
export function describeValidity(row: ComboCardRow): ComboValidity | null {
  const from: ComboEdge = { date: formatDmy(row.fromDate), time: normalizeHm(row.fromTime) }
  const to: ComboEdge = { date: formatDmy(row.toDate), time: normalizeHm(row.toTime) }
  if (!from.date && !to.date) return null
  const part = (edge: ComboEdge) => [edge.date || '—', edge.time].filter(Boolean).join(' ')
  return { from, to, text: `${part(from)} → ${part(to)}` }
}

export type ComboZones = {
  /** Các nhóm máy hiển thị trực tiếp (tối đa `maxVisible`). */
  visible: string[]
  /** Số nhóm còn lại gộp thành "+N". */
  hiddenCount: number
  /** Tên các nhóm bị gộp — cho tooltip của viên "+N". */
  hidden: string[]
  /** Toàn bộ nhóm, ngăn bởi ", " — cho tooltip / đọc màn hình. */
  text: string
}

/**
 * Cột "Máy": server trả tên các nhóm máy áp dụng nối bằng '|' (DAOCombo::get; DAOComboCard::check_apply_zone tách
 * đúng bằng '|'). Tách ra từng nhóm, bỏ phần rỗng/khoảng trắng; không có nhóm nào ⇒ null (hiển thị "—").
 */
export function describeZones(zone: string | undefined | null, maxVisible = 2): ComboZones | null {
  const all = (zone ?? '')
    .split('|')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (all.length === 0) return null
  const visible = all.slice(0, Math.max(1, maxVisible))
  const hidden = all.slice(visible.length)
  return { visible, hidden, hiddenCount: hidden.length, text: all.join(', ') }
}

export type ComboTimeRange =
  | { kind: 'unknown' }
  | { kind: 'all-day'; text: string }
  | { kind: 'range'; from: string; to: string; text: string }

/**
 * Khung giờ dùng trong ngày. Server cũ không trả fromTime/toTime ⇒ 'unknown' (hiển thị "—").
 * from == to ⇒ 'all-day' ("Cả ngày"); `text` luôn giữ nguyên số liệu thô như MFC ("00:00 → 00:00") cho tooltip.
 */
export function describeTimeRange(row: ComboCardRow): ComboTimeRange {
  const from = normalizeHm(row.fromTime)
  const to = normalizeHm(row.toTime)
  if (!from || !to) return { kind: 'unknown' }
  const text = `${from} → ${to}`
  if (from === to) return { kind: 'all-day', text }
  return { kind: 'range', from, to, text }
}

/** Khoá so sánh theo thời gian: ISO `YYYY-MM-DD HH:MM` so chuỗi được. Thiếu ngày kết thúc ⇒ rỗng (xếp đầu khi tăng dần). */
function validityKey(row: ComboCardRow): string {
  const date = (row.toDate ?? '').trim()
  return date ? `${date} ${normalizeHm(row.toTime)}` : ''
}

function sortKeyOf(row: ComboCardRow, key: ComboCardSortKey): string {
  switch (key) {
    case 'userName': return row.userName ?? ''
    case 'zone': return row.zone ?? ''
    case 'validity': return validityKey(row)
    case 'timeRange': return `${normalizeHm(row.fromTime)} ${normalizeHm(row.toTime)}`.trim()
    case 'note': return row.note ?? ''
  }
}

/** Sắp xếp ổn định, KHÔNG đổi mảng gốc. `key = null` ⇒ giữ thứ tự server (mới nhất trước, như MFC). */
export function sortComboCards(
  rows: readonly ComboCardRow[],
  key: ComboCardSortKey | null,
  direction: 'asc' | 'desc',
): ComboCardRow[] {
  if (!key) return [...rows]
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const compared = sortKeyOf(a.row, key).localeCompare(sortKeyOf(b.row, key), 'vi', {
        numeric: true,
        sensitivity: 'base',
      })
      return compared !== 0 ? compared * sign : a.index - b.index
    })
    .map((item) => item.row)
}

/** Seed cho Drawer chi tiết (CustomerInspector đọc UserAccount): thẻ combo không có ví/hồ sơ nên các trường đó rỗng. */
export function comboCardToSeed(row: ComboCardRow): UserAccount {
  return {
    userId: row.userId,
    userName: row.userName,
    firstName: '',
    lastName: '',
    groupName: '',
    idNumber: '',
    phone: '',
    email: '',
    note: row.note ?? '',
    moneyPaid: 0,
    moneyRemain: 0,
    moneyUsed: 0,
    moneyFree: 0,
    moneyTransfer: 0,
    moneyMain: 0,
    moneySub: 0,
    debit: 0,
    isUnder18: 0,
  }
}
