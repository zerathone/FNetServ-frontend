import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, PageHeader, Segmented, type SegmentedOption } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { ClosingTab } from './ClosingTab'
import { LedgerTab } from './LedgerTab'
import { UnitsDialog } from './MaterialDialogs'
import { MaterialsTab } from './MaterialsTab'
import './inventory.css'

// Danh mục nguyên liệu quản lý ở tab Nguyên liệu của trang Kho; công thức/món bán kèm sửa thẳng trong form
// dịch vụ. Tồn kho thành phẩm nay ở trang Dịch vụ & hàng hóa (tab Quản lý tồn). Link cũ `?tab=finished|recipes`
// rơi về tab mặc định.
const TABS = ['materials', 'ledger', 'closing'] as const
type Tab = (typeof TABS)[number]

const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'materials', label: 'Nguyên liệu' },
  { value: 'ledger', label: 'Sổ kho & tiêu hao' },
  { value: 'closing', label: 'Chốt kỳ' },
]

function readTab(raw: string | null): Tab {
  return (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'materials'
}

/** Trang Kho (task topping-kho / T3f). Tab nằm trong `?tab=` để mở thẳng/đánh dấu được. */
export function InventoryWorkspace() {
  const [params, setParams] = useSearchParams()
  const tab = readTab(params.get('tab'))
  // Đơn vị tính dùng chung cho dịch vụ và nguyên liệu ⇒ nút đặt ở đầu trang khi đang ở tab Nguyên liệu.
  const canUnit = useAuthStore((s) => s.hasRight)(67)
  const [unitsOpen, setUnitsOpen] = useState(false)

  return (
    <section className="inv-workspace">
      <PageHeader
        eyebrow="Quản lý"
        title="Kho & nguyên liệu"
        description="Danh mục nguyên liệu, sổ kho & tiêu hao nguyên liệu và chốt kỳ. Tồn kho hàng hóa nằm ở trang Dịch vụ & hàng hóa."
        actions={
          tab === 'materials' ? (
            <Button
              type="button"
              variant="outline"
              disabled={!canUnit}
              title={canUnit ? 'Danh sách đơn vị tính dùng chung cho dịch vụ và nguyên liệu' : 'Cần quyền Quản lý đơn vị tính (67)'}
              onClick={() => setUnitsOpen(true)}
            >
              Đơn vị tính
            </Button>
          ) : undefined
        }
      />
      <Segmented<Tab>
        ariaLabel="Chức năng kho"
        value={tab}
        options={TAB_OPTIONS}
        onChange={(next) => setParams(next === 'materials' ? {} : { tab: next }, { replace: true })}
      />
      {tab === 'materials' ? <MaterialsTab /> : null}
      {tab === 'ledger' ? <LedgerTab /> : null}
      {tab === 'closing' ? <ClosingTab /> : null}
      <UnitsDialog open={unitsOpen} canEdit={canUnit} onClose={() => setUnitsOpen(false)} />
    </section>
  )
}
