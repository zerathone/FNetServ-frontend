// task work-shift S2 — bảng doanh thu ca: nguồn × hình thức. Dùng ở Drawer Thông tin ca (đủ cột) và Dialog Chốt ca (gọn).
// Cấn trừ chỉ để xem (nhạt + chú thích), KHÔNG cộng vào Tổng (Q16b). Hoàn tiền là dòng riêng (số âm), đã nằm trong các nguồn.
import type { ShiftSummary } from '../../api/shift'
import { formatMoney } from './shiftModel'
import './shifts.css'

const num = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

type Props = {
  summary: ShiftSummary
  /** Gọn: chỉ Nguồn | Lượt | Tổng (Dialog Chốt ca). */
  compact?: boolean
}

export function ShiftSummaryTable({ summary, compact = false }: Props) {
  const { sources, totals, refund } = summary
  const hasRefund = refund.count > 0 || refund.cash !== 0 || refund.online !== 0
  const cols = compact ? 3 : 7

  return (
    <div className="shift-table-block">
      <div className="shift-table-wrap" role="region" aria-label="Doanh thu ca theo nguồn" tabIndex={0}>
        <table className="shift-table">
          <thead>
            <tr>
              <th scope="col">Nguồn thu</th>
              <th scope="col" className="shift-table__num">Lượt</th>
              {compact ? null : (
                <>
                  <th scope="col" className="shift-table__num">Tiền mặt</th>
                  <th scope="col" className="shift-table__num">Chuyển khoản</th>
                  <th scope="col" className="shift-table__num">QR</th>
                  <th
                    scope="col"
                    className="shift-table__num shift-table__deduct"
                    title="Không cộng vào tổng — tiền đã tính lúc nạp ví"
                  >
                    Cấn trừ*
                  </th>
                </>
              )}
              <th scope="col" className="shift-table__num">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={cols} className="shift-table__empty">Chưa có khoản thu nào trong ca.</td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={source.key}>
                  <th scope="row">{source.name}</th>
                  <td className="shift-table__num">{num(source.count)}</td>
                  {compact ? null : (
                    <>
                      <td className="shift-table__num">{num(source.cash)}</td>
                      <td className="shift-table__num">{num(source.online)}</td>
                      <td className="shift-table__num">{num(source.qr)}</td>
                      <td className="shift-table__num shift-table__deduct">{num(source.deduct)}</td>
                    </>
                  )}
                  <td className="shift-table__num shift-table__total">{num(source.total)}</td>
                </tr>
              ))
            )}
            {hasRefund ? (
              <tr className="shift-table__refund">
                <th scope="row" title="Đã trừ sẵn trong các nguồn ở trên, hiển thị riêng để đối soát">
                  Hoàn tiền
                </th>
                <td className="shift-table__num">{num(refund.count)}</td>
                {compact ? null : (
                  <>
                    <td className="shift-table__num">{num(refund.cash)}</td>
                    <td className="shift-table__num">{num(refund.online)}</td>
                    <td className="shift-table__num">—</td>
                    <td className="shift-table__num shift-table__deduct">—</td>
                  </>
                )}
                <td className="shift-table__num">{num(refund.cash + refund.online)}</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Doanh thu ca</th>
              <td className="shift-table__num">{num(totals.count)}</td>
              {compact ? null : (
                <>
                  <td className="shift-table__num">{num(totals.cash)}</td>
                  <td className="shift-table__num">{num(totals.online)}</td>
                  <td className="shift-table__num">{num(totals.qr)}</td>
                  <td className="shift-table__num shift-table__deduct">{num(totals.deduct)}</td>
                </>
              )}
              <td className="shift-table__num shift-table__total">{formatMoney(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {compact ? null : (
        <p className="shift-table__note">
          * Cấn trừ không cộng vào tổng — tiền đã được tính lúc nạp ví.
          {hasRefund ? ' Hoàn tiền (số âm) đã được trừ sẵn trong các nguồn ở trên.' : ''}
        </p>
      )}
    </div>
  )
}
