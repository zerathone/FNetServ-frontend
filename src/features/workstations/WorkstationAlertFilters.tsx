import { CurrencyCircleDollar, Money, Warning } from '@phosphor-icons/react'
import { useSustained } from './useSustained'
import type { WorkstationFilter } from './workstationModel'
import './workstation-alert-filters.css'

// Nút lọc nhanh cho ba trạng thái CẦN XỬ LÝ NGAY: máy còn nợ (tiền giờ chơi), khách đã rời còn nợ dịch vụ, và máy cảnh báo.
// Chỉ hiện khi có ít nhất 1 máy (hoặc bộ lọc đó đang bật — để còn chỗ bấm tắt khi số máy về 0).
// Riêng CẢNH BÁO không nhạy: máy rớt mạng chớp nhoáng là chuyện thường, nên nút chỉ hiện khi có máy cảnh báo LIÊN TỤC
// WARNING_SUSTAIN_MS (2,5 phút); về 0 máy là tắt ngay. Còn nợ / Nợ dịch vụ hiện ngay (MFC cũng rung chuông ngay).
// Đặt ở hàng nút đầu trang, BÊN TRÁI nút "Chờ tính tiền" (không đặt ở thanh công cụ vì hàng đó bị khối "Chờ duyệt" kiểu thẻ ngang chiếm / che).
// Bấm lần nữa để bỏ lọc (về "Tất cả").

/** Thời gian máy cảnh báo phải kéo dài liên tục trước khi nút Cảnh báo xuất hiện (2–3 phút, chọn mức giữa). */
const WARNING_SUSTAIN_MS = 150_000

type AlertKey = Extract<WorkstationFilter, 'debt' | 'serviceDebt' | 'warning'>

type WorkstationAlertFiltersProps = {
  debtCount: number
  /** Khách đã rời máy còn nợ dịch vụ chưa thu tiền. */
  serviceDebtCount: number
  warningCount: number
  filter: WorkstationFilter
  onFilterChange: (filter: WorkstationFilter) => void
}

export function WorkstationAlertFilters({ debtCount, serviceDebtCount, warningCount, filter, onFilterChange }: WorkstationAlertFiltersProps) {
  const warningSustained = useSustained(warningCount > 0, WARNING_SUSTAIN_MS)
  const items: Array<{ key: AlertKey; label: string; count: number; show: boolean; icon: typeof Money }> = [
    { key: 'debt', label: 'Còn nợ', count: debtCount, show: debtCount > 0, icon: Money },
    { key: 'serviceDebt', label: 'Nợ dịch vụ', count: serviceDebtCount, show: serviceDebtCount > 0, icon: CurrencyCircleDollar },
    { key: 'warning', label: 'Cảnh báo', count: warningCount, show: warningSustained, icon: Warning },
  ]
  const visible = items.filter((item) => item.show || filter === item.key)
  if (visible.length === 0) return null

  return (
    <div className="ws-alert-filters" role="group" aria-label="Lọc nhanh máy cần xử lý">
      {visible.map(({ key, label, count, icon: Icon }) => {
        const active = filter === key
        return (
          <button
            key={key}
            type="button"
            className={`ws-alert-filter ws-alert-filter--${key}${active ? ' is-active' : ''}`}
            aria-pressed={active}
            title={active ? `Đang lọc ${label.toLocaleLowerCase('vi-VN')} — bấm để bỏ lọc` : `Chỉ xem máy ${label.toLocaleLowerCase('vi-VN')}`}
            onClick={() => onFilterChange(active ? 'all' : key)}
          >
            <Icon size={16} weight="fill" aria-hidden="true" />
            <span>{label}</span>
            <span className="ws-alert-filter__count">{count}</span>
          </button>
        )
      })}
    </div>
  )
}
