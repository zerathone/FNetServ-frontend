import { PageHeader } from '../../design-system/components'
import './checkout.css'
import { CardSalePanel } from './CardSalePanel'

export function CardSaleWorkspace() {
  return (
    <div className="checkout-workspace">
      <PageHeader
        eyebrow="Thu ngân"
        title="Bán thẻ nạp"
        description="Bán thẻ nạp tiền theo mệnh giá còn tồn kho, thu tiền mặt tại quầy."
      />

      <CardSalePanel />
    </div>
  )
}
