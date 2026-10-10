import { useQuery } from '@tanstack/react-query'
import { Bank, CheckCircle, CurrencyCircleDollar, HandCoins, QrCode } from '@phosphor-icons/react'
import { getComboSalesStats, type ComboSaleMethod } from '../../api/combo'
import { formatShiftStart } from '../../lib/shiftTime'
// Dùng lại đúng giao diện ô "Hoàn thành" của /orders (class global `order-summary__*`).
import '../orders/orders.css'

const METHOD_LABEL: Record<ComboSaleMethod, string> = {
  cash: 'Tiền mặt',
  qr: 'QR',
  online: 'Chuyển khoản',
  deduct: 'Cấn trừ',
}

const METHOD_ICON: Record<ComboSaleMethod, typeof CheckCircle> = {
  cash: CurrencyCircleDollar,
  qr: QrCode,
  online: Bank,
  deduct: HandCoins,
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function ComboSalesSummary() {
  const statsQuery = useQuery({
    queryKey: ['combo-sales-stats'],
    queryFn: getComboSalesStats,
    refetchInterval: 30_000,
    retry: false,
  })
  const stats = statsQuery.data
  const shiftStart = formatShiftStart(stats?.shiftStart)

  return (
    <div className="order-summary combo-sales-summary" aria-label="Thống kê bán COMBO">
      <div className="order-summary__card order-summary__card--completed">
        <div
          className="order-summary__total order-summary__total--completed"
          title="Thẻ COMBO đã thu tiền xong trong 24 giờ gần nhất, toàn quán (cùng khung thời gian với trang Đơn dịch vụ). Số đếm là số thẻ."
        >
          <CheckCircle className="order-summary__total-icon" size={28} weight="fill" aria-hidden="true" />
          <div className="order-summary__total-completed-text">
            <span className="order-summary__total-label">Doanh thu</span>
            <strong className="order-summary__total-amount">
              {stats ? formatMoney(stats.completed.amount) : '—'}
            </strong>
            <small className="order-summary__total-count">
              {stats ? stats.completed.count : '—'} thẻ
            </small>
            {shiftStart ? (
              <small className="order-summary__total-count" title="Thời điểm bắt đầu tính thống kê này (giờ máy chủ).">
                Ca từ {shiftStart}
              </small>
            ) : null}
          </div>
        </div>
        {stats ? (
          <div className="order-summary__breakdown">
            {stats.completed.byType.map((row, index) => {
              const MethodIcon = METHOD_ICON[row.key]
              return (
                <div key={row.key} className="combo-sales-summary__method">
                  {index > 0 ? (
                    <span className="order-summary__breakdown-divider" aria-hidden="true">
                      |
                    </span>
                  ) : null}
                  <div className="order-summary__row order-summary__completed-method">
                    <span className="order-summary__row-label-line">
                      <span className="order-summary__label">{METHOD_LABEL[row.key]}</span>
                    </span>
                    <strong className="order-summary__row-amount">{formatMoney(row.amount)}</strong>
                    <small className="order-summary__row-count">{row.count} thẻ</small>
                    <MethodIcon
                      className={`order-summary__row-icon-bg order-summary__row-icon-bg--${row.key}`}
                      size={30}
                      weight="fill"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              )
            })}
            {/* Dấu "|" khép sau ô Cấn trừ (ô cuối) cho cân với các dấu phân cách giữa các hình thức thu. */}
            <span className="order-summary__breakdown-divider" aria-hidden="true">
              |
            </span>
          </div>
        ) : statsQuery.isError ? (
          <small className="order-summary__hint">Không tải được thống kê bán COMBO.</small>
        ) : null}
      </div>
    </div>
  )
}
