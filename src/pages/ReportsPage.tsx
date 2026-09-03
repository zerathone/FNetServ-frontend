import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRevenueSummary } from '../api/reports'
import { useAuthStore } from '../store/auth'

// Quyền báo cáo doanh thu (RightTb) — khớp gate backend /reports/revenue (2.16b).
const RIGHT_REVENUE_REPORT = 9311

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value)
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

const paymentTypeNames: Record<number, string> = {
  2: 'Phí dịch vụ',
  3: 'Cấn trừ dịch vụ',
  17: 'Bán thẻ Combo tiền mặt',
  23: 'Thẻ Combo Online',
  25: 'Thẻ Combo QR',
}

function getPaymentTypeName(type: number) {
  return paymentTypeNames[type] || `Khác (${type})`
}

export function ReportsPage() {
  const [from, setFrom] = useState(getToday())
  const [to, setTo] = useState(getToday())
  const [staffId, setStaffId] = useState('')

  // Proactive RBAC (mirror grey-out MFC): không có quyền 9311 thì không gọi API,
  // disabled input + báo cho user thay vì để backend trả 403.
  const canViewReport = useAuthStore((s) => s.hasRight(RIGHT_REVENUE_REPORT))

  const isReady = Boolean(from && to)
  const reportQuery = useQuery({
    queryKey: ['revenue-summary', from, to, staffId],
    queryFn: () => getRevenueSummary({ from, to, staffId }),
    enabled: isReady && canViewReport,
  })

  const byType = useMemo(() => reportQuery.data?.byType ?? [], [reportQuery.data])

  return (
    <section className="page-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Phase 3 · Task 3.8</p>
          <h2 className="section-title">Reports</h2>
        </div>
      </div>

      <p className="page-description">
        Revenue summary dùng `GET /reports/revenue?from=&to=&staffId=` với định dạng ngày
        `YYYY-MM-DD`.
      </p>

      {!canViewReport ? (
        <p className="status-text error-text">
          Bạn không có quyền xem báo cáo doanh thu (cần quyền báo cáo). Vui lòng liên hệ quản trị
          viên.
        </p>
      ) : null}

      <div className="toolbar-grid toolbar-grid-3">
        <label className="field compact-field">
          <span>Từ ngày</span>
          <input
            type="date"
            value={from}
            disabled={!canViewReport}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="field compact-field">
          <span>Đến ngày</span>
          <input
            type="date"
            value={to}
            disabled={!canViewReport}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label className="field compact-field">
          <span>Mã nhân viên (Staff ID)</span>
          <input
            value={staffId}
            disabled={!canViewReport}
            onChange={(event) => setStaffId(event.target.value)}
          />
        </label>
      </div>

      <div className="stats-grid single-stat-grid">
        <div className="stat-card">
          <span className="stat-label">Tổng doanh thu (Total revenue)</span>
          <strong className="stat-value">{formatMoney(reportQuery.data?.total ?? 0)}</strong>
        </div>
      </div>

      {reportQuery.isLoading ? <p className="status-text">Đang tải báo cáo...</p> : null}
      {reportQuery.isError ? (
        <p className="status-text error-text">{(reportQuery.error as Error).message}</p>
      ) : null}

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Loại thanh toán (Payment type)</th>
              <th style={{ textAlign: 'right' }}>Số tiền (Amount)</th>
            </tr>
          </thead>
          <tbody>
            {byType.length > 0 ? (
              byType.map((item) => (
                <tr key={item.paymentType}>
                  <td>
                    <span style={{ fontWeight: 500 }}>
                      {getPaymentTypeName(item.paymentType)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 500, fontFamily: 'monospace', fontSize: '1.1em' }}>
                    {formatMoney(item.amount)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>
          {byType.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ fontWeight: 'bold', fontSize: '1.1em', padding: '0.75rem 1rem' }}>Tổng cộng (Total)</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--primary)', fontFamily: 'monospace', fontSize: '1.2em', padding: '0.75rem 1rem' }}>
                  {formatMoney(reportQuery.data?.total ?? 0)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
