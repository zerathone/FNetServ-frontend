// Thống kê tổng hợp doanh thu theo nguồn thu cho báo cáo income-summary (type 41, hằng ngày).
// Giao diện dùng lại CSS ws-summary của WorkstationWorkspace — layout card bên trái tổng, bên phải breakdown.
// Chỉ dùng cho time_display === 0 (hằng ngày) vì tuần/tháng là pivot, không có cột Phương thức.

import { useMemo } from 'react'

// Thứ tự cột trong REPORT_COLUMNS[41]:
// idx 0 = Tên đăng nhập, 1 = Ngày, 2 = Thời điểm, 3 = Nguồn thu (desc),
// idx 4 = Số tiền, 5 = Phương thức (desc), 6 = Nhân viên,
// idx 7 = Số nguồn thu (hidden, số), idx 8 = Giao dịch
const COL_REVENUE_DESC = 3
const COL_AMOUNT = 4
const COL_METHOD_DESC = 5
const COL_REVENUE_NUM = 7

// Tất cả nguồn thu chuẩn — luôn hiện đủ dù không có dòng nào (theo REVENUE_SOURCE_OPTIONS, bỏ value=0).
const ALL_REVENUE_SOURCES: { num: number; label: string }[] = [
  { num: 1, label: 'Tiền nạp hội viên' },
  { num: 2, label: 'Tiền giờ khách vãng lai' },
  { num: 3, label: 'Combo' },
  { num: 4, label: 'Thẻ nạp tiền' },
  { num: 5, label: 'Dịch vụ [FNet]' },
  { num: 7, label: 'Công nợ (trả nợ)' },
]

type RowArr = unknown[]

interface Breakdown {
  cash: number
  transfer: number
  qr: number
  total: number
}

interface RevenueStat {
  revenueNum: number
  label: string
  breakdown: Breakdown
}

function normalizeAmount(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0
  return 0
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value)) + ' đ'
}

function classifyMethod(methodDesc: string): 'cash' | 'transfer' | 'qr' | 'other' {
  const s = String(methodDesc ?? '').toLowerCase()
  if (s.includes('mặt') || s === 'cash') return 'cash'
  if (s.includes('khoản') || s.includes('transfer') || s.includes('bank')) return 'transfer'
  if (s.includes('qr')) return 'qr'
  return 'other'
}

function buildStats(data: unknown[]): RevenueStat[] {
  // Pre-populate với tất cả nguồn thu chuẩn — đảm bảo luôn hiện đủ card dù không có dòng nào.
  const map = new Map<number, RevenueStat>()
  for (const src of ALL_REVENUE_SOURCES) {
    map.set(src.num, {
      revenueNum: src.num,
      label: src.label,
      breakdown: { cash: 0, transfer: 0, qr: 0, total: 0 },
    })
  }

  for (const row of data) {
    if (!Array.isArray(row)) continue
    const arr = row as RowArr
    const revenueNum =
      typeof arr[COL_REVENUE_NUM] === 'number'
        ? (arr[COL_REVENUE_NUM] as number)
        : parseInt(String(arr[COL_REVENUE_NUM] ?? '0'), 10) || 0
    const amount = normalizeAmount(arr[COL_AMOUNT])
    const methodKind = classifyMethod(String(arr[COL_METHOD_DESC] ?? ''))
    const label = String(arr[COL_REVENUE_DESC] ?? `Nguồn #${revenueNum}`)

    if (!map.has(revenueNum)) {
      // Nguồn thu không có trong danh sách chuẩn (dữ liệu cũ / mở rộng) — thêm động.
      map.set(revenueNum, {
        revenueNum,
        label,
        breakdown: { cash: 0, transfer: 0, qr: 0, total: 0 },
      })
    }
    const stat = map.get(revenueNum)!
    stat.breakdown.total += amount
    if (methodKind === 'cash') stat.breakdown.cash += amount
    else if (methodKind === 'transfer') stat.breakdown.transfer += amount
    else if (methodKind === 'qr') stat.breakdown.qr += amount
    // 'other' chỉ cộng vào total
  }

  // Sắp xếp theo ALL_REVENUE_SOURCES; nguồn động xuống cuối theo số.
  const knownOrder = ALL_REVENUE_SOURCES.map((s) => s.num)
  const stats = [...map.values()]
  stats.sort((a, b) => {
    const oa = knownOrder.indexOf(a.revenueNum)
    const ob = knownOrder.indexOf(b.revenueNum)
    if (oa === -1 && ob === -1) return a.revenueNum - b.revenueNum
    if (oa === -1) return 1
    if (ob === -1) return -1
    return oa - ob
  })
  return stats
}

function buildTotal(stats: RevenueStat[]): Breakdown {
  return stats.reduce(
    (acc, s) => ({
      cash: acc.cash + s.breakdown.cash,
      transfer: acc.transfer + s.breakdown.transfer,
      qr: acc.qr + s.breakdown.qr,
      total: acc.total + s.breakdown.total,
    }),
    { cash: 0, transfer: 0, qr: 0, total: 0 },
  )
}

interface SummaryCardProps {
  label: string
  breakdown: Breakdown
}

function SummaryCard({ label, breakdown }: SummaryCardProps) {
  return (
    <div className="ws-summary__card">
      <div className="ws-summary__total" style={{ cursor: 'default' }}>
        <span>{label}</span>
        <strong>{formatMoney(breakdown.total)}</strong>
      </div>
      <div className="ws-summary__breakdown">
        <div className="ws-summary__row">
          <span
            className="ws-summary__dot"
            style={{ background: 'var(--color-success)' }}
            aria-hidden="true"
          />
          <span className="ws-summary__label">Tiền mặt</span>
          <strong>{formatMoney(breakdown.cash)}</strong>
        </div>
        <div className="ws-summary__row">
          <span
            className="ws-summary__dot"
            style={{ background: 'var(--color-info)' }}
            aria-hidden="true"
          />
          <span className="ws-summary__label">Chuyển khoản</span>
          <strong>{formatMoney(breakdown.transfer)}</strong>
        </div>
        <div className="ws-summary__row">
          <span
            className="ws-summary__dot"
            style={{ background: 'var(--color-warning)' }}
            aria-hidden="true"
          />
          <span className="ws-summary__label">QR</span>
          <strong>{formatMoney(breakdown.qr)}</strong>
        </div>
      </div>
    </div>
  )
}

interface Props {
  data: unknown
}

export function IncomeSummaryStats({ data }: Props) {
  const stats = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return null
    return buildStats(data as unknown[])
  }, [data])

  if (!stats || stats.length === 0) return null

  const total = buildTotal(stats)

  return (
    <div
      className="ws-summary"
      aria-label="Thống kê doanh thu tổng hợp"
      style={{ marginBottom: '24px' }}
    >
      {/* Card tổng tất cả nguồn thu */}
      <SummaryCard label="Tất cả" breakdown={total} />

      {/* Card từng nguồn thu */}
      {stats.map((s) => (
        <SummaryCard key={s.revenueNum} label={s.label} breakdown={s.breakdown} />
      ))}
    </div>
  )
}
