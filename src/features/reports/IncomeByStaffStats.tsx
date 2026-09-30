// Thống kê tổng hợp doanh thu theo nhân viên cho báo cáo income-by-staff (type 42).
//
// Layout mỗi card:
//   [Tên NV + Tổng] | [Phương thức: Tiền mặt / CK / QR] || [Nguồn thu: 6 loại]
//   Cụm phương thức và cụm nguồn thu phân biệt bằng màu nền + đường kẻ dọc.
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

import React, { useMemo } from 'react'

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

interface StaffStat {
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

function parseNum(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val.replace(/[^0-9.-]/g, '')) || 0
  return 0
}

function fmt(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value)) + ' đ'
}

function buildStats(data: unknown[]): StaffStat[] {
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

function sumStats(stats: StaffStat[]): Omit<StaffStat, 'name'> {
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

// ─── Một hàng trong cụm ─────────────────────────────────────────────────────
function Row({ dot, label, value }: { dot?: string; label: string; value: number }) {
  return (
    <div className="ws-summary__row">
      {dot !== undefined ? (
        <span className="ws-summary__dot" style={{ background: dot }} aria-hidden="true" />
      ) : (
        <span style={{ width: '0.55rem', flex: '0 0 auto' }} />
      )}
      <span className="ws-summary__label">{label}</span>
      <strong>{fmt(value)}</strong>
    </div>
  )
}

// ─── Card một nhân viên / tổng ───────────────────────────────────────────────
// Phân biệt 2 cụm bằng màu border-left + nền tint (không dùng label text):
//   Xanh (info)   = Phương thức thanh toán — 3 dòng, có dot màu
//   Tím (chart-4) = Nguồn thu              — 6 dòng, dot trung tính
const BLOCK_METHOD: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--color-info) 6%, var(--color-surface-raised))',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--color-info) 20%, transparent)',
  borderLeft: '3px solid var(--color-info)',
  padding: 'var(--space-2) var(--space-3)',
  gap: '4px',
}
const BLOCK_SOURCE: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--color-chart-4) 6%, var(--color-surface-raised))',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--color-chart-4) 20%, transparent)',
  borderLeft: '3px solid var(--color-chart-4)',
  padding: 'var(--space-2) var(--space-3)',
  gap: '4px',
}

function StaffStatCard({ label, stat }: { label: string; stat: Omit<StaffStat, 'name'> }) {
  return (
    <div className="ws-summary__card" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>

      {/* Cột 1: Tên + tổng */}
      <div className="ws-summary__total" style={{ cursor: 'default', minWidth: '7rem' }}>
        <span>{label}</span>
        <strong>{fmt(stat.total)}</strong>
      </div>

      {/* Cột 2: Phương thức — viền xanh */}
      <div className="ws-summary__breakdown" style={BLOCK_METHOD}>
        <Row dot="var(--color-success)" label="Tiền mặt"     value={stat.cash} />
        <Row dot="var(--color-info)"    label="Chuyển khoản" value={stat.transfer} />
        <Row dot="var(--color-warning)" label="QR"           value={stat.qr} />
      </div>

      {/* Cột 3: Nguồn thu — viền tím */}
      <div className="ws-summary__breakdown" style={BLOCK_SOURCE}>
        <Row label="Nạp hội viên"    value={stat.recharge} />
        <Row label="Khách vãng lai"  value={stat.anonym} />
        <Row label="Combo"           value={stat.combo} />
        <Row label="Thẻ nạp tiền"   value={stat.card} />
        <Row label="Dịch vụ [FNet]" value={stat.service} />
        <Row label="Công nợ"         value={stat.debt} />
      </div>

    </div>
  )
}

// ─── Export: income-by-staff (type 42) ───────────────────────────────────────
interface Props {
  data: unknown
}

export function IncomeByStaffStats({ data }: Props) {
  const stats = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return null
    return buildStats(data as unknown[])
  }, [data])

  if (!stats || stats.length === 0) return null

  const total = sumStats(stats)

  return (
    <div
      className="ws-summary"
      aria-label="Thống kê doanh thu theo nhân viên"
      style={{ marginBottom: '24px' }}
    >
      <StaffStatCard label="Tất cả" stat={total} />
      {stats.map((s, idx) => (
        <StaffStatCard key={`${s.name}-${idx}`} label={s.name || `NV#${idx + 1}`} stat={s} />
      ))}
    </div>
  )
}

// ─── Export: shift-report (type 43) ──────────────────────────────────────────
// Type 43 là pivot 7 dòng cố định:
//   Row 0-5: từng nguồn thu [tên, count, tiền mặt, CK, QR, tổng]
//   Row 6  : tổng "Doanh thu" — lấy col tiền mặt/CK/QR/tổng từ đây
// Vì shift-report luôn chọn 1 NV cụ thể (noAllStaff), chỉ hiện 1 card.
interface ShiftProps {
  data: unknown
  staffName?: string
}

function buildStatFromShift(data: unknown[]): Omit<StaffStat, 'name'> | null {
  if (!Array.isArray(data) || data.length < 7) return null
  const p = (row: unknown, col: number) =>
    parseNum(Array.isArray(row) ? (row as RowArr)[col] : 0)
  return {
    recharge: p(data[0], 5),
    anonym:   p(data[1], 5),
    combo:    p(data[2], 5),
    card:     p(data[3], 5),
    service:  p(data[4], 5),
    debt:     p(data[5], 5),
    cash:     p(data[6], 2),
    transfer: p(data[6], 3),
    qr:       p(data[6], 4),
    total:    p(data[6], 5),
  }
}

export function ShiftReportStats({ data, staffName }: ShiftProps) {
  const stat = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return null
    return buildStatFromShift(data as unknown[])
  }, [data])

  if (!stat) return null

  return (
    <div
      className="ws-summary"
      aria-label="Thống kê báo cáo ca"
      style={{ marginBottom: '24px' }}
    >
      <StaffStatCard label={staffName || 'Nhân viên'} stat={stat} />
    </div>
  )
}
