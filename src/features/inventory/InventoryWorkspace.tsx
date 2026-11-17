import { useSearchParams } from 'react-router-dom'
import { PageHeader, Segmented, type SegmentedOption } from '../../design-system/components'
import { ClosingTab } from './ClosingTab'
import { FinishedTab } from './FinishedTab'
import { LedgerTab } from './LedgerTab'
import './inventory.css'

// Danh mục nguyên liệu nay quản lý ở trang Dịch vụ & hàng hóa (tab Nguyên liệu); công thức/món bán kèm sửa
// thẳng trong form dịch vụ. Link cũ `?tab=materials|recipes` rơi về tab mặc định.
const TABS = ['finished', 'ledger', 'closing'] as const
type Tab = (typeof TABS)[number]

const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'finished', label: 'Kho thành phẩm' },
  { value: 'ledger', label: 'Sổ kho & tiêu hao' },
  { value: 'closing', label: 'Chốt kỳ' },
]

function readTab(raw: string | null): Tab {
  return (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'finished'
}

/** Trang Kho (task topping-kho / T3f). Tab nằm trong `?tab=` để mở thẳng/đánh dấu được. */
export function InventoryWorkspace() {
  const [params, setParams] = useSearchParams()
  const tab = readTab(params.get('tab'))

  return (
    <section className="inv-workspace">
      <PageHeader
        eyebrow="Quản lý"
        title="Kho"
        description="Kho thành phẩm, sổ kho & tiêu hao nguyên liệu và chốt kỳ. Danh mục nguyên liệu nằm ở trang Dịch vụ & hàng hóa."
      />
      <Segmented<Tab>
        ariaLabel="Chức năng kho"
        value={tab}
        options={TAB_OPTIONS}
        onChange={(next) => setParams(next === 'finished' ? {} : { tab: next }, { replace: true })}
      />
      {tab === 'finished' ? <FinishedTab /> : null}
      {tab === 'ledger' ? <LedgerTab /> : null}
      {tab === 'closing' ? <ClosingTab /> : null}
    </section>
  )
}
