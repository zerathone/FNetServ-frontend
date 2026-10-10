import { EyeSlash } from '@phosphor-icons/react'
import { usePendingComboOrders } from './comboPendingModel'

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

type ComboPendingToggleProps = {
  open: boolean
  onToggle: () => void
}

/**
 * Nút "Chờ xác nhận" (combo chờ duyệt) nằm sau nút lọc nhóm máy cuối cùng trên thanh lọc của /combo_sale
 * (user chốt 2026-10-10). Cùng dáng viên thuốc với các nút lọc nhóm máy nhưng tách riêng bằng vạch ngăn;
 * có đơn chờ thì viền/ô số chuyển màu cảnh báo vì đó là tiền mặt đang chờ quầy xác nhận.
 */
export function ComboPendingToggle({ open, onToggle }: ComboPendingToggleProps) {
  const { query, orders, total } = usePendingComboOrders()
  const count = query.isError ? null : orders.length
  const hasPending = (count ?? 0) > 0

  return (
    <button
      type="button"
      className={`combo-pending-toggle${open ? ' is-active' : ''}${hasPending ? ' has-pending' : ''}`}
      aria-pressed={open}
      onClick={onToggle}
      title={
        open
          ? 'Bấm lần nữa để ẩn danh sách và quay lại danh mục bán.'
          : 'Combo khách mua từ máy trạm đang chờ thu ngân xác nhận đã nhận tiền mặt.'
      }
    >
      {/* Đang mở danh sách: icon mắt gạch chéo báo "bấm nữa để ẩn / quay về trạng thái cũ". */}
      {open ? <EyeSlash size={16} weight="bold" aria-hidden="true" /> : null}
      <span>Chờ xác nhận</span>
      <b className="combo-pending-toggle__count">{count ?? '—'}</b>
      {hasPending ? <small className="combo-pending-toggle__amount">{formatMoney(total)}</small> : null}
    </button>
  )
}
