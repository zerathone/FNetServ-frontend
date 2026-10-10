import { useState } from 'react'
import { PageHeader } from '../../design-system/components'
import './checkout.css'
import { ComboSalePanel } from './ComboSalePanel'
import { ComboSalesSummary } from './ComboSalesSummary'

export function CheckoutWorkspace() {
  // Nút "Chờ xác nhận" trên thanh lọc nhóm máy: danh mục bán <-> danh sách combo chờ xác nhận, CÙNG vị trí
  // (ComboSalePanel tự render cả hai trong 1 thẻ; phần bán chỉ ẩn, không unmount).
  const [pendingOpen, setPendingOpen] = useState(false)

  return (
    <div className="checkout-workspace">
      <PageHeader eyebrow="Thu ngân" title="Bán COMBO" />

      <ComboSalesSummary />
      <ComboSalePanel pendingOpen={pendingOpen} onTogglePending={() => setPendingOpen((open) => !open)} />
    </div>
  )
}
