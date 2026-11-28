import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from '@phosphor-icons/react'
import { Button, InlineAlert, PageHeader, Segmented, type SegmentedOption } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { useMaterialFeature } from './useMaterialFeature'
import { VOUCHER_BUTTON_LABEL, type MaterialMoveType } from './inventoryModel'
import { ClosingPeriodBar, ClosingTab } from './ClosingTab'
import { MaterialBatchDialog } from './MaterialBatchDialog'
import { LedgerTab } from './LedgerTab'
import { UnitsDialog } from './MaterialDialogs'
import { MaterialsTab } from './MaterialsTab'
import { MaterialStockTab } from './MaterialStockTab'
import './inventory.css'

// Trang Kho có 2 tab: Nguyên liệu (danh mục) và Quản lý kho (Tồn kho | Nhập kho | Xuất/trả | Tiêu hao theo đơn | Kiểm kê |
// Chốt kỳ). Công thức/món bán kèm sửa thẳng trong form dịch vụ; tồn kho hàng hóa ở trang Dịch vụ & hàng hóa (tab Quản lý tồn).
// URL: `?tab=stock&view=import|export|usage|stocktake|closing` (mặc định Tồn kho). Link cũ `?tab=ledger` rơi về Tồn kho,
// `?tab=closing` vẫn mở Chốt kỳ; `?tab=finished|recipes` rơi về tab mặc định.
const TABS = ['materials', 'stock'] as const
type Tab = (typeof TABS)[number]

const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'materials', label: 'Nguyên liệu' },
  { value: 'stock', label: 'Quản lý kho' },
]

// Thứ tự mục: Tồn kho, Nhập kho, Xuất/trả, Tiêu hao theo đơn, Kiểm kê, Chốt kỳ.
const VIEWS = ['onhand', 'import', 'export', 'usage', 'stocktake', 'closing'] as const
type StockView = (typeof VIEWS)[number]

const DEFAULT_VIEW: StockView = 'onhand'

const VIEW_OPTIONS: readonly SegmentedOption<StockView>[] = [
  { value: 'onhand', label: 'Tồn kho' },
  { value: 'import', label: 'Nhập kho' },
  { value: 'export', label: 'Xuất/trả' },
  { value: 'usage', label: 'Tiêu hao theo đơn' },
  { value: 'stocktake', label: 'Kiểm kê' },
  { value: 'closing', label: 'Chốt kỳ' },
]

/** Mục nào có nút "Tạo phiếu" → loại phiếu tương ứng (1 nhập, 2 xuất/trả, 3 kiểm kê). */
const VIEW_VOUCHER_TYPE: Partial<Record<StockView, MaterialMoveType>> = { import: 1, export: 2, stocktake: 3 }

function readView(raw: string | null): StockView {
  return (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as StockView) : DEFAULT_VIEW
}

/** Đọc `?tab=` + `?view=` (kèm link cũ `tab=ledger|closing`) → tab chính và mục con của Quản lý kho. */
function readLocation(params: URLSearchParams): { tab: Tab; view: StockView } {
  const raw = params.get('tab')
  // Link cũ: "Sổ kho & tiêu hao" (đã tách theo loại phiếu) và "Chốt kỳ".
  if (raw === 'ledger') return { tab: 'stock', view: DEFAULT_VIEW }
  if (raw === 'closing') return { tab: 'stock', view: 'closing' }
  if (raw === 'stock') return { tab: 'stock', view: readView(params.get('view')) }
  return { tab: 'materials', view: DEFAULT_VIEW }
}

/** Trang Kho (task topping-kho / T3f). Tab + mục con nằm trên URL để mở thẳng/đánh dấu được. */
export function InventoryWorkspace() {
  const [params, setParams] = useSearchParams()
  const { tab, view } = readLocation(params)
  // Đơn vị tính dùng chung cho dịch vụ và nguyên liệu ⇒ nút đặt ở đầu trang khi đang ở tab Nguyên liệu.
  const canUnit = useAuthStore((s) => s.hasRight)(67)
  const [unitsOpen, setUnitsOpen] = useState(false)
  // Nhập / xuất-trả / kiểm kê đều cần quyền Điều chỉnh kho (68) ở máy chủ. Nút "Tạo phiếu" chỉ có ở 3 mục phiếu tương ứng.
  const canStock = useAuthStore((s) => s.hasRight)(68)
  const [voucher, setVoucher] = useState<MaterialMoveType | null>(null)
  const voucherType = tab === 'stock' ? VIEW_VOUCHER_TYPE[view] : undefined
  // Menu đã ẩn mục này khi cờ tắt; vào thẳng bằng đường dẫn thì nói rõ vì sao đơn mới không trừ nguyên liệu.
  const materialFeatureOff = useMaterialFeature().enabled === false

  const changeView = (next: StockView) =>
    setParams(next === DEFAULT_VIEW ? { tab: 'stock' } : { tab: 'stock', view: next }, { replace: true })

  return (
    <section className="inv-workspace">
      <PageHeader
        eyebrow="Quản lý"
        title="Kho & nguyên liệu"
        description="Danh mục nguyên liệu, tồn kho, phiếu nhập, xuất/trả, kiểm kê, tiêu hao theo đơn và chốt kỳ."
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
      {materialFeatureOff ? (
        <InlineAlert tone="info">
          Bán kèm và kho nguyên liệu đang tắt (Cài đặt → Đơn hàng). Đơn mới không trừ nguyên liệu; dữ liệu đã có vẫn xem và chỉnh được.
        </InlineAlert>
      ) : null}
      <Segmented<Tab>
        ariaLabel="Chức năng kho"
        value={tab}
        options={TAB_OPTIONS}
        onChange={(next) => setParams(next === 'materials' ? {} : { tab: 'stock' }, { replace: true })}
      />
      {tab === 'materials' ? <MaterialsTab /> : null}
      {tab === 'stock' ? (
        <div className="inv-stack">
          <div className="inv-viewbar">
            <Segmented<StockView> ariaLabel="Mục quản lý kho" value={view} options={VIEW_OPTIONS} onChange={changeView} />
            {view === 'onhand' ? (
              <div className="inv-viewbar__actions">
                <ClosingPeriodBar />
              </div>
            ) : null}
            {voucherType !== undefined ? (
              <div className="inv-viewbar__actions">
                <Button
                  type="button"
                  variant="primary"
                  icon={<Plus size={16} weight="bold" aria-hidden="true" />}
                  disabled={!canStock}
                  title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                  onClick={() => setVoucher(voucherType)}
                >
                  {VOUCHER_BUTTON_LABEL[voucherType]}
                </Button>
              </div>
            ) : null}
          </div>
          {view === 'onhand' ? <MaterialStockTab /> : null}
          {view === 'closing' ? <ClosingTab /> : null}
          {view !== 'onhand' && view !== 'closing' ? <LedgerTab view={view} /> : null}
        </div>
      ) : null}
      {voucher !== null ? <MaterialBatchDialog msType={voucher} onClose={() => setVoucher(null)} /> : null}
      <UnitsDialog open={unitsOpen} canEdit={canUnit} onClose={() => setUnitsOpen(false)} />
    </section>
  )
}
