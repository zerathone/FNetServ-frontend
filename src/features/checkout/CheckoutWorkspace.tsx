import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../design-system/components'
import './checkout.css'
import { ComboSalePanel } from './ComboSalePanel'
import { ComboSalesSummary } from './ComboSalesSummary'

export function CheckoutWorkspace() {
  // Nút "Chờ xác nhận" trên thanh lọc nhóm máy: danh mục bán <-> danh sách combo chờ xác nhận, CÙNG vị trí
  // (ComboSalePanel tự render cả hai trong 1 thẻ; phần bán chỉ ẩn, không unmount).
  // `/combo_sale?pending=1` (vd từ drawer chi tiết máy ở trang Máy trạm) mở sẵn danh sách chờ xác nhận.
  const [searchParams] = useSearchParams()
  const [pendingOpen, setPendingOpen] = useState(() => searchParams.get('pending') === '1')

  return (
    <div className="checkout-workspace">
      <PageHeader eyebrow="Thu ngân" title="Bán COMBO" />

      <ComboSalesSummary />
      <ComboSalePanel pendingOpen={pendingOpen} onTogglePending={() => setPendingOpen((open) => !open)} />
    </div>
  )
}
