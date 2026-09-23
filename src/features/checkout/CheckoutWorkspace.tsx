import { InlineAlert, PageHeader } from '../../design-system/components'
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

      <InlineAlert tone="info">
        Tất toán tab dịch vụ vẫn được khóa vì chưa có danh sách voucher và chi tiết
        chưa trả đáng tin cậy. Bán COMBO bên dưới đã dùng danh mục authoritative mới.
      </InlineAlert>

      <ComboSalePanel />
    </div>
  )
}
