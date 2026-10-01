// Mô hình dữ liệu dùng chung cho thống kê / biểu đồ income-by-staff (type 42) và shift-report (43).
// Tách khỏi component để fast-refresh không cảnh báo.
//
// Thứ tự cột trong REPORT_COLUMNS[42]:
// idx 0  = Nhân viên
// idx 1  = Tiền nạp hội viên
// idx 2  = Tiền giờ khách vãng lai
// idx 3  = Combo
// idx 4  = Thẻ nạp tiền
// idx 5  = Tiền dịch vụ (FNet)
// idx 6  = Công nợ (trả nợ)
// idx 7  = Doanh thu [Tiền mặt]
// idx 8  = Doanh thu [Chuyển khoản]
// idx 9  = Doanh thu [QR]
// idx 10 = Doanh thu tổng

const COL_STAFF    = 0
const COL_RECHARGE = 1
const COL_ANONYM   = 2
const COL_COMBO    = 3
const COL_CARD     = 4
const COL_SERVICE  = 5
const COL_DEBT     = 6
const COL_CASH     = 7
const COL_TRANSFER = 8
const COL_QR       = 9
const COL_TOTAL    = 10

type RowArr = unknown[]

export interface StaffStat {
  name: string
  recharge: number
  anonym: number
  combo: number
  card: number
  service: number
  debt: number
  cash: number
  transfer: number
  qr: number
  total: number
}

export function parseNum(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0
  return 0
}

export function buildStats(data: unknown[]): StaffStat[] {
  return data
    .filter(Array.isArray)
    .map((arr: RowArr) => ({
      name:     String(arr[COL_STAFF] ?? ''),
      recharge: parseNum(arr[COL_RECHARGE]),
      anonym:   parseNum(arr[COL_ANONYM]),
      combo:    parseNum(arr[COL_COMBO]),
      card:     parseNum(arr[COL_CARD]),
      service:  parseNum(arr[COL_SERVICE]),
      debt:     parseNum(arr[COL_DEBT]),
      cash:     parseNum(arr[COL_CASH]),
      transfer: parseNum(arr[COL_TRANSFER]),
      qr:       parseNum(arr[COL_QR]),
      total:    parseNum(arr[COL_TOTAL]),
    }))
}

export function sumStats(stats: StaffStat[]): Omit<StaffStat, 'name'> {
  return stats.reduce(
    (acc, s) => ({
      recharge: acc.recharge + s.recharge,
      anonym:   acc.anonym   + s.anonym,
      combo:    acc.combo    + s.combo,
      card:     acc.card     + s.card,
      service:  acc.service  + s.service,
      debt:     acc.debt     + s.debt,
      cash:     acc.cash     + s.cash,
      transfer: acc.transfer + s.transfer,
      qr:       acc.qr       + s.qr,
      total:    acc.total    + s.total,
    }),
    { recharge: 0, anonym: 0, combo: 0, card: 0, service: 0, debt: 0, cash: 0, transfer: 0, qr: 0, total: 0 },
  )
}
