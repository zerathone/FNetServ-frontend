// Biểu đồ income-by-staff (type 42): 2 bảng-biểu đồ — Phương thức thanh toán và Nguồn thu.
//
// Bố cục (mỗi bảng):
//                  | Tất cả       | NHÂN VIÊN 1        | NHÂN VIÊN 2 ...
//   Tổng           | <số tiền>    | bar + số tiền + %  | bar + số tiền + %
//   Tiền mặt       | <số tiền>    | bar + số tiền + %  | ...
// Hàng = mục (tổng / từng phương thức / từng nguồn thu); cột = Tất cả rồi từng nhân viên.
// % trong ô nhân viên = phần ĐÓNG GÓP của nhân viên đó vào cột "Tất cả" ở cùng hàng, và độ dài
// thanh = chính % đó (nên so sánh được giữa các nhân viên trong cùng hàng).
// Cột "Tất cả" chỉ có con số (không bar, không %). Khi xem MỘT nhân viên, số "Tất cả" lấy từ truy vấn
// tất cả nhân viên (allData) để % so sánh được với toàn bộ; thiếu allData thì rơi về chính dữ liệu đang xem.

import { useMemo } from 'react'
import { buildStats, sumStats, type StaffStat } from './incomeByStaffModel'

// Màu thanh theo HẠNG MỤC (không theo nhân viên), khớp cụm Thống kê trong IncomeByStaffStats:
//   Phương thức: Tiền mặt = success, Chuyển khoản = info, QR = warning
//   Nguồn thu  : mỗi loại một màu, cùng bảng màu với IncomePivotChart (doanh thu tuần/tháng)
//   Tổng       : màu chính

const VND = new Intl.NumberFormat('vi-VN')

type Metrics = Omit<StaffStat, 'name'>
type Category = { key: keyof Metrics; label: string; color: string; emphasize?: boolean }

const METHOD_CATEGORIES: Category[] = [
  { key: 'total',    label: 'Tổng', color: 'var(--color-action-primary)', emphasize: true },
  { key: 'cash',     label: 'Tiền mặt',     color: 'var(--color-success)' },
  { key: 'transfer', label: 'Chuyển khoản', color: 'var(--color-info)' },
  { key: 'qr',       label: 'QR',           color: 'var(--color-warning)' },
]

const SOURCE_CATEGORIES: Category[] = [
  { key: 'recharge', label: 'Nạp hội viên', color: '#6366f1' },
  { key: 'anonym', label: 'Khách vãng lai', color: '#22d3ee' },
  { key: 'combo', label: 'Combo', color: '#f59e0b' },
  { key: 'card', label: 'Thẻ nạp tiền', color: '#10b981' },
  { key: 'service', label: 'Dịch vụ [FNet]', color: '#ec4899' },
  { key: 'debt', label: 'Công nợ', color: '#8b5cf6' },
]

type StaffEntry = { name: string; stat: StaffStat }

const LABEL_COL = '8.5rem'
const ALL_COL = '8rem'
const STAFF_COL_MIN = '10.5rem'
const STAFF_COL_MAX = '18rem'   // cột không giãn quá dài khi ít nhân viên


function Cell({ amount, pct, color }: { amount: number; pct: number; color: string }) {
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: 500, color: amount > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
          {VND.format(Math.round(amount))}
        </span>
        <span style={{ fontWeight: 500, color: 'var(--color-text-muted)' }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 10, borderRadius: 5, background: 'var(--color-border-subtle, #f1f5f9)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', borderRadius: 5, background: color, opacity: 0.85 }} />
      </div>
    </div>
  )
}

function StaffChartTable({
  title,
  categories,
  staff,
  all,
}: {
  title: string
  categories: Category[]
  staff: StaffEntry[]
  all: Metrics
}) {
  const columns = `${LABEL_COL} ${ALL_COL} ${staff.map(() => `minmax(${STAFF_COL_MIN}, ${STAFF_COL_MAX})`).join(' ')}`
  const minWidth = `calc(${LABEL_COL} + ${ALL_COL} + ${staff.length} * ${STAFF_COL_MIN} + ${(staff.length + 2) * 12}px)`
  const rowStyle = { display: 'grid', gridTemplateColumns: columns, gap: 12, alignItems: 'center' } as const

  return (
    <section
      style={{
        width: 'fit-content',
        minWidth: 'min(100%, 32rem)',
        maxWidth: '100%',
        justifySelf: 'start',
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-raised)',
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
        }}
      >
        {title}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth, display: 'grid', gap: 0 }}>
          <div style={{ ...rowStyle, paddingBottom: 8 }}>
            <span />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>Tất cả</span>
            {staff.map((s) => (
              <span
                key={s.name}
                title={s.name}
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}
              >
                {s.name}
              </span>
            ))}
          </div>

          {categories.map((c) => {
            const allValue = all[c.key]
            return (
              <div
                key={c.key}
                style={{
                  ...rowStyle,
                  padding: '10px 0',
                  borderTop: '1px solid var(--color-border-subtle, #f1f5f9)',
                  background: c.emphasize ? 'color-mix(in srgb, var(--color-text-muted) 5%, transparent)' : undefined,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: c.emphasize ? 600 : 500, color: 'var(--color-text-primary)' }}>
                  {c.label}
                </span>
                {/* Cột "Tất cả": chỉ có con số (không bar, không %) — làm mẫu số cho % của cột nhân viên */}
                <span style={{ fontSize: 12, fontWeight: c.emphasize ? 600 : 500, fontVariantNumeric: 'tabular-nums', color: allValue > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                  {VND.format(Math.round(allValue))}
                </span>
                {staff.map((s) => {
                  const v = s.stat[c.key]
                  return <Cell key={s.name} amount={v} pct={allValue > 0 ? (v / allValue) * 100 : 0} color={c.color} />
                })}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// Chế độ "Tất cả nhân viên": so sánh các nhân viên với nhau — hàng = Tất cả rồi từng nhân viên,
// cột = các hạng mục. Hàng "Tất cả" và cột Tổng chỉ có con số; các ô còn lại có bar + % so với
// số của hàng "Tất cả" trong cùng cột (phần đóng góp của nhân viên).
function StaffCompareTable({
  title,
  categories,
  staff,
  all,
}: {
  title: string
  categories: Category[]
  staff: StaffEntry[]
  all: Metrics
}) {
  const columns = `${LABEL_COL} ${categories.map(() => `minmax(${STAFF_COL_MIN}, ${STAFF_COL_MAX})`).join(' ')}`
  const minWidth = `calc(${LABEL_COL} + ${categories.length} * ${STAFF_COL_MIN} + ${(categories.length + 1) * 12}px)`
  const rowStyle = { display: 'grid', gridTemplateColumns: columns, gap: 12, alignItems: 'center' } as const
  const numberOnly = (value: number) => (
    <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: value > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
      {VND.format(Math.round(value))}
    </span>
  )

  return (
    <section
      style={{
        width: 'fit-content',
        minWidth: 'min(100%, 32rem)',
        maxWidth: '100%',
        justifySelf: 'start',
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-raised)',
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
        }}
      >
        {title}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth, display: 'grid', gap: 0 }}>
          <div style={{ ...rowStyle, paddingBottom: 8 }}>
            <span />
            {categories.map((c) => (
              <span key={c.key} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {c.label}
              </span>
            ))}
          </div>

          <div style={{ ...rowStyle, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle, #f1f5f9)', background: 'color-mix(in srgb, var(--color-text-muted) 5%, transparent)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>Tất cả</span>
            {categories.map((c) => (
              <span key={c.key}>{numberOnly(all[c.key])}</span>
            ))}
          </div>

          {staff.map((s) => (
            <div key={s.name} style={{ ...rowStyle, padding: '10px 0', borderTop: '1px solid var(--color-border-subtle, #f1f5f9)' }}>
              <span title={s.name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                {s.name}
              </span>
              {categories.map((c) => {
                const v = s.stat[c.key]
                const allValue = all[c.key]
                return c.emphasize ? (
                  <span key={c.key}>{numberOnly(v)}</span>
                ) : (
                  <Cell key={c.key} amount={v} pct={allValue > 0 ? (v / allValue) * 100 : 0} color={c.color} />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function IncomeByStaffCharts({ data, allData, allStaff }: { data: unknown; allData?: unknown; allStaff: boolean }) {
  const { staff, all } = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return { staff: [] as StaffEntry[], all: null }
    const stats = buildStats(data as unknown[])
    return {
      staff: stats.map((stat, idx) => ({
        name: stat.name || `NV#${idx + 1}`,
        stat,
      })),
      all: sumStats(Array.isArray(allData) && allData.length > 0 ? buildStats(allData as unknown[]) : stats),
    }
  }, [data, allData])

  if (staff.length === 0 || !all) return null

  const Table = allStaff ? StaffCompareTable : StaffChartTable

  return (
    <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
      <Table title="Phương thức thanh toán" categories={METHOD_CATEGORIES} staff={staff} all={all} />
      <Table title="Nguồn thu" categories={SOURCE_CATEGORIES} staff={staff} all={all} />
    </div>
  )
}
