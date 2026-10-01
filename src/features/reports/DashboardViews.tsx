// DashboardViews.tsx — Render component cho 7 dashboard type (34–40).
// Mỗi exported function tương ứng 1 type, nhận data: unknown từ /rptv2.
// CSS ws-summary/* và data-table đã import qua workstations.css ở ReportPage.tsx.

import { type ReactNode } from 'react'

// ─── Format helpers ──────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  const num =
    typeof v === 'number'
      ? v
      : parseFloat(String(v ?? '0').replace(/[^\d.-]/g, '')) || 0
  return new Intl.NumberFormat('vi-VN').format(Math.round(num)) + '\u00a0đ'
}

function fmtMin(v: unknown): string {
  const m = Number(v) || 0
  if (m === 0) return '0 phút'
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} phút`
  if (r === 0) return `${h} giờ`
  return `${h}g\u00a0${r}p`
}

function fmtNum(v: unknown): string {
  return new Intl.NumberFormat('vi-VN').format(Number(v) || 0)
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// ─── Shared primitives ───────────────────────────────────────────────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        fontSize: '0.8125rem',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        margin: '20px 0 8px',
      }}
    >
      {children}
    </p>
  )
}

type BreakdownRow = { dot?: string; text: string; value: string }

/** Card tiền tệ có breakdown tuỳ chọn — dùng ws-summary__card. */
function MoneyCard({
  label,
  total,
  rows,
}: {
  label: string
  total: unknown
  rows?: BreakdownRow[]
}) {
  return (
    <div className="ws-summary__card">
      <div className="ws-summary__total" style={{ cursor: 'default' }}>
        <span>{label}</span>
        <strong>{fmt(total)}</strong>
      </div>
      {rows && rows.length > 0 && (
        <div className="ws-summary__breakdown">
          {rows.map((r, i) => (
            <div key={i} className="ws-summary__row">
              {r.dot && (
                <span
                  className="ws-summary__dot"
                  style={{ background: r.dot }}
                  aria-hidden="true"
                />
              )}
              <span className="ws-summary__label">{r.text}</span>
              <strong>{r.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Card số đếm (không phải tiền) — dùng ws-summary__card. */
function CountCard({
  label,
  value,
  rows,
}: {
  label: string
  value: ReactNode
  rows?: { text: string; value: ReactNode }[]
}) {
  return (
    <div className="ws-summary__card">
      <div className="ws-summary__total" style={{ cursor: 'default' }}>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      {rows && rows.length > 0 && (
        <div className="ws-summary__breakdown">
          {rows.map((r, i) => (
            <div key={i} className="ws-summary__row">
              <span className="ws-summary__label">{r.text}</span>
              <strong>{r.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Income cards — dùng chung cho type 34 và type 35 ────────────────────────

function IncomeCards({ d }: { d: Record<string, unknown> }) {
  const member = asObj(d.member)
  const service = asObj(d.service)
  const anonymous = asObj(d.anonymous)
  const cards = asObj(d.cards)

  return (
    <div className="ws-summary" style={{ marginBottom: 24 }}>
      <MoneyCard label="Tổng doanh thu" total={d.total} />
      <MoneyCard
        label="Hội viên"
        total={member.total}
        rows={[
          { dot: 'var(--color-success)', text: 'Tiền mặt', value: fmt(member.cash) },
          { dot: 'var(--color-info)', text: 'Online / QR', value: fmt(member.online) },
        ]}
      />
      <MoneyCard label="Khách vãng lai" total={anonymous.total} />
      <MoneyCard
        label="Dịch vụ"
        total={service.total}
        rows={[
          { dot: 'var(--color-success)', text: 'Tiền mặt', value: fmt(service.cash) },
          { dot: 'var(--color-info)', text: 'Online / QR', value: fmt(service.online) },
        ]}
      />
      <MoneyCard label="Thẻ & Combo" total={cards.total} />
    </div>
  )
}

// ─── type 34 — Dashboard Doanh thu ───────────────────────────────────────────

interface RechargeItem {
  value?: unknown
  session?: unknown
}

export function DashboardIncomeView({ data }: { data: unknown }) {
  const d = asObj(data)
  const recharges = asArr(d.member_recharge) as RechargeItem[]

  return (
    <div>
      <IncomeCards d={d} />

      {recharges.length > 0 && (
        <>
          <SectionTitle>Mệnh giá nạp phổ biến (hội viên)</SectionTitle>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
            {recharges.map((r, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 12px',
                  borderRadius: 999,
                  background: 'var(--color-surface-raised)',
                  border: '1px solid var(--color-border-default)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                {fmt(r.value)}
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                  ×{fmtNum(r.session)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── type 35 — Dashboard Mobile (machine + account + income gộp) ─────────────

export function DashboardMobileView({ data }: { data: unknown }) {
  const d = asObj(data)
  const income = asObj(d.income)

  return (
    <div>
      <SectionTitle>Máy tính</SectionTitle>
      <div className="ws-summary" style={{ marginBottom: 24 }}>
        <CountCard label="Máy đang online" value={fmtNum(d.pc_online)} />
        <CountCard label="Thời gian dùng máy" value={fmtMin(d.pc_timeuse)} />
      </div>

      <SectionTitle>Tài khoản</SectionTitle>
      <div className="ws-summary" style={{ marginBottom: 24 }}>
        <CountCard
          label="Hội viên"
          value={`${fmtNum(d.member_login)} phiên`}
          rows={[
            { text: 'TK mới', value: fmtNum(d.member_new) },
            { text: 'Thời gian', value: fmtMin(d.member_timeuse) },
          ]}
        />
        <CountCard
          label="Combo"
          value={`${fmtNum(d.combo_login)} phiên`}
          rows={[
            { text: 'TK mới', value: fmtNum(d.combo_new) },
            { text: 'Thời gian', value: fmtMin(d.combo_timeuse) },
          ]}
        />
      </div>

      <SectionTitle>Doanh thu</SectionTitle>
      <IncomeCards d={income} />
    </div>
  )
}

// ─── type 36 — Dashboard Khách hàng ──────────────────────────────────────────

function AccountGroupCard({
  label,
  g,
}: {
  label: string
  g: Record<string, unknown>
}) {
  return (
    <div className="ws-summary__card">
      <div className="ws-summary__total" style={{ cursor: 'default' }}>
        <span>{label}</span>
        <strong>{fmtNum(g.session)} phiên</strong>
      </div>
      <div className="ws-summary__breakdown">
        <div className="ws-summary__row">
          <span className="ws-summary__label">Thời gian</span>
          <strong>{fmtMin(g.time)}</strong>
        </div>
        <div className="ws-summary__row">
          <span className="ws-summary__label">TK sử dụng</span>
          <strong>{fmtNum(g.recharge)}</strong>
        </div>
        <div className="ws-summary__row">
          <span className="ws-summary__label">TK mới</span>
          <strong>{fmtNum(g.new)}</strong>
        </div>
      </div>
    </div>
  )
}

export function DashboardCustomersView({ data }: { data: unknown }) {
  const d = asObj(data)
  return (
    <div className="ws-summary" style={{ marginBottom: 24 }}>
      <AccountGroupCard label="Hội viên" g={asObj(d.member)} />
      <AccountGroupCard label="Combo" g={asObj(d.combo)} />
      <AccountGroupCard label="Khách vãng lai" g={asObj(d.anonymous)} />
    </div>
  )
}

// ─── type 37 — Dashboard Khách hàng chi tiết ─────────────────────────────────

const UGTYPE_LABEL: Record<string, string> = {
  '0': 'Khách vãng lai',
  '1': 'Hội viên',
  '2': 'Combo',
}

interface PriceGroupRow {
  name?: unknown
  session?: unknown
  time?: unknown
  recharge?: unknown
  new?: unknown
}

export function DashboardCustomersDetailView({ data }: { data: unknown }) {
  const d = asObj(data)
  // Thứ tự hiển thị: HV → Combo → KVL
  const keys = ['1', '2', '0']

  return (
    <div>
      {keys.map((key) => {
        const rows = asArr(d[key]) as PriceGroupRow[]
        return (
          <div key={key} style={{ marginBottom: 24 }}>
            <SectionTitle>{UGTYPE_LABEL[key] ?? `Nhóm ${key}`}</SectionTitle>
            <div className="table-card" style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th>Gói giá</th>
                    <th>Phiên</th>
                    <th>Thời gian</th>
                    <th>TK sử dụng</th>
                    <th>TK mới</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}
                      >
                        Không có dữ liệu
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => (
                      <tr key={i}>
                        <td>{String(r.name ?? '')}</td>
                        <td>{fmtNum(r.session)}</td>
                        <td>{fmtMin(r.time)}</td>
                        <td>{fmtNum(r.recharge)}</td>
                        <td>{fmtNum(r.new)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── type 38 — Dashboard Sử dụng máy ────────────────────────────────────────

export function DashboardMachineUsageView({ data }: { data: unknown }) {
  const d = asObj(data)
  return (
    <div className="ws-summary" style={{ marginBottom: 24 }}>
      <CountCard label="Tổng phiên" value={fmtNum(d.session)} />
      <CountCard label="Thời gian sử dụng" value={fmtMin(d.time_use)} />
      <CountCard label="Số máy đã dùng" value={fmtNum(d.pc_use)} />
    </div>
  )
}

// ─── type 39 — Dashboard Sử dụng máy chi tiết ───────────────────────────────
// Server trả về ARRAY (không phải object) — asArr(data) là đúng.

interface MachineGroupRow {
  machine_group?: unknown
  session?: unknown
  time_use?: unknown
  pc_use?: unknown
}

export function DashboardMachineDetailView({ data }: { data: unknown }) {
  const rows = asArr(data) as MachineGroupRow[]
  return (
    <div className="table-card" style={{ overflowX: 'auto', marginBottom: 24 }}>
      <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            <th>Nhóm máy</th>
            <th>Phiên</th>
            <th>Thời gian</th>
            <th>Số máy dùng</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={4}
                style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}
              >
                Không có dữ liệu
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <td>{String(r.machine_group ?? '(chưa phân nhóm)')}</td>
                <td>{fmtNum(r.session)}</td>
                <td>{fmtMin(r.time_use)}</td>
                <td>{fmtNum(r.pc_use)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── type 40 — Dashboard Thống kê tài khoản ─────────────────────────────────
// Đếm TK active trong usertb — không phải phiên dùng máy (khác type 36).

function AccountStatsCard({
  label,
  d,
}: {
  label: string
  d: Record<string, unknown>
}) {
  return (
    <div className="ws-summary__card">
      <div className="ws-summary__total" style={{ cursor: 'default' }}>
        <span>{label}</span>
        <strong>{fmtNum(d.total)}</strong>
      </div>
      <div className="ws-summary__breakdown">
        <div className="ws-summary__row">
          <span className="ws-summary__label">Đăng ký mới</span>
          <strong>{fmtNum(d.new)}</strong>
        </div>
        <div className="ws-summary__row">
          <span className="ws-summary__label">Đăng nhập</span>
          <strong>{fmtNum(d.recharge)}</strong>
        </div>
      </div>
    </div>
  )
}

export function DashboardAccountStatsView({ data }: { data: unknown }) {
  const d = asObj(data)
  return (
    <div className="ws-summary" style={{ marginBottom: 24 }}>
      <AccountStatsCard label="Hội viên" d={asObj(d.member)} />
      <AccountStatsCard label="Combo" d={asObj(d.combo)} />
      <AccountStatsCard label="Khách vãng lai" d={asObj(d.anonymous)} />
    </div>
  )
}
