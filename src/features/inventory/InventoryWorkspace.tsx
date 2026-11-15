import { useSearchParams } from 'react-router-dom'
import { PageHeader, Segmented, type SegmentedOption } from '../../design-system/components'
import { ClosingTab } from './ClosingTab'
import { FinishedTab } from './FinishedTab'
import { LedgerTab } from './LedgerTab'
import { MaterialsTab } from './MaterialsTab'
import { RecipeTab } from './RecipeTab'
import './inventory.css'

const TABS = ['materials', 'recipes', 'finished', 'ledger', 'closing'] as const
type Tab = (typeof TABS)[number]

const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'materials', label: 'Nguyên liệu' },
  { value: 'recipes', label: 'Công thức & topping' },
  { value: 'finished', label: 'Kho thành phẩm' },
  { value: 'ledger', label: 'Sổ kho & tiêu hao' },
  { value: 'closing', label: 'Chốt kỳ' },
]

function readTab(raw: string | null): Tab {
  return (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'materials'
}

/** Trang Kho & nguyên liệu (task topping-kho / T3f). Tab nằm trong `?tab=` để mở thẳng/đánh dấu được. */
export function InventoryWorkspace() {
  const [params, setParams] = useSearchParams()
  const tab = readTab(params.get('tab'))

  return (
    <section className="inv-workspace">
      <PageHeader
        eyebrow="Quản lý"
        title="Kho & nguyên liệu"
        description="Danh mục nguyên liệu, công thức món, nhập/xuất/kiểm kê, kho thành phẩm và chốt kỳ."
      />
      <Segmented<Tab>
        ariaLabel="Chức năng kho"
        value={tab}
        options={TAB_OPTIONS}
        onChange={(next) => setParams(next === 'materials' ? {} : { tab: next }, { replace: true })}
      />
      {tab === 'materials' ? <MaterialsTab /> : null}
      {tab === 'recipes' ? <RecipeTab /> : null}
      {tab === 'finished' ? <FinishedTab /> : null}
      {tab === 'ledger' ? <LedgerTab /> : null}
      {tab === 'closing' ? <ClosingTab /> : null}
    </section>
  )
}
