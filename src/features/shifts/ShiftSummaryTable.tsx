// task work-shift S2 — bảng doanh thu ca: nguồn × hình thức. Dùng ở Drawer Thông tin ca (đủ cột) và Dialog Chốt ca (gọn).
// Cấn trừ chỉ để xem (nhạt + chú thích), KHÔNG cộng vào Tổng (Q16b). Hoàn tiền là dòng riêng (số âm), đã nằm trong các nguồn.
// S3 (F2): có `onCellClick` ⇒ ô số khác 0 thành nút bấm để xem danh sách giao dịch của ô đó (drill-down của trang quản lý).
import type { ShiftSource, ShiftSummary } from '../../api/shift'
import { formatMoney } from './shiftModel'
import { methodLabel, type PaymentMethodKey } from './shiftManageModel'
import './shifts.css'

const num = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

/** `source = null` ⇒ mọi nguồn (dòng tổng); `method = null` ⇒ mọi hình thức (cột Tổng). */
export type ShiftCellTarget = { source: ShiftSource | null; method: PaymentMethodKey | null }

type Props = {
  summary: ShiftSummary
  /** Gọn: chỉ Nguồn | Lượt | Tổng (Dialog Chốt ca). */
  compact?: boolean
  /** Bật drill-down: bấm ô số để xem giao dịch. */
  onCellClick?: (target: ShiftCellTarget) => void
}

export function ShiftSummaryTable({ summary, compact = false, onCellClick }: Props) {
  const { sources, totals, refund } = summary
  const hasRefund = refund.count > 0 || refund.cash !== 0 || refund.online !== 0 || refund.qr !== 0
  const cols = compact ? 3 : 7

  const cell = (
    value: number,
    text: string,
    target: ShiftCellTarget,
    className = 'shift-table__num',
  ) => {
    const canClick = Boolean(onCellClick) && value !== 0
    const label = `Xem giao dịch ${target.source?.name ?? 'mọi nguồn'}${target.method ? ` · ${methodLabel(target.method)}` : ''}`
    return (
      <td className={className}>
        {canClick ? (
          <button type="button" className="shift-table__link" aria-label={label} title={label} onClick={() => onCellClick?.(target)}>
            {text}
          </button>
        ) : (
          text
        )}
      </td>
    )
  }

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
                      {cell(source.cash, num(source.cash), { source, method: 'cash' })}
                      {cell(source.online, num(source.online), { source, method: 'online' })}
                      {cell(source.qr, num(source.qr), { source, method: 'qr' })}
                      {cell(source.deduct, num(source.deduct), { source, method: 'deduct' }, 'shift-table__num shift-table__deduct')}
                    </>
                  )}
                  {cell(source.total, num(source.total), { source, method: null }, 'shift-table__num shift-table__total')}
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
                    <td className="shift-table__num">{num(refund.qr)}</td>
                    <td className="shift-table__num shift-table__deduct">—</td>
                  </>
                )}
                <td className="shift-table__num">{num(refund.cash + refund.online + refund.qr)}</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Doanh thu ca</th>
              <td className="shift-table__num">{num(totals.count)}</td>
              {compact ? null : (
                <>
                  {cell(totals.cash, num(totals.cash), { source: null, method: 'cash' })}
                  {cell(totals.online, num(totals.online), { source: null, method: 'online' })}
                  {cell(totals.qr, num(totals.qr), { source: null, method: 'qr' })}
                  {cell(totals.deduct, num(totals.deduct), { source: null, method: 'deduct' }, 'shift-table__num shift-table__deduct')}
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
          {onCellClick ? ' Bấm vào một ô số để xem danh sách giao dịch.' : ''}
        </p>
      )}
    </div>
  )
}
