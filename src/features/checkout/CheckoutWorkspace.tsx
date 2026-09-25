import { PageHeader } from '../../design-system/components'
import './checkout.css'
import { ComboSalePanel } from './ComboSalePanel'

export function CheckoutWorkspace() {
  return (
    <div className="checkout-workspace">
      <PageHeader
        eyebrow="Thu ngân"
        title="Bán COMBO"
        description="Thu tiền từ dữ liệu máy chủ, không nhập mã giao dịch hoặc số tiền thủ công."
      />

      <ComboSalePanel />
    </div>
  )
}
