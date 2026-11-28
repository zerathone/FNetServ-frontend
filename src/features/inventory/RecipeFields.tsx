import { ForkKnife, Money, Package, Scales, Trash, TrendDown } from '@phosphor-icons/react'
import type { MaterialRow } from '../../api/inventory'
import type { ServiceItem } from '../../api/services'
import { Button, IconButton, InlineAlert, Select, Switch } from '../../design-system/components'
import { GROUP_TYPE_TOPPING } from '../services/serviceCatalogModel'
import { formatMoney } from './finishedStockModel'
import { nextDraftKey, setRecipeEnabled, type RecipeDraft, type ToppingDraft } from './recipeDraftModel'
import './inventory.css'

// Ô nhập công thức + món bán kèm (controlled, không có nút Lưu). Dùng ở form Thêm/Sửa dịch vụ
// và ở form Thêm/Sửa dịch vụ (lưu cùng lần bấm "Lưu"). Kiểu dáng `.inv-*` nằm trong inventory.css.

export function RecipeFields({
  draft,
  onChange,
  materials,
  disabled,
  toppingGroup,
}: {
  draft: RecipeDraft
  onChange: (next: RecipeDraft) => void
  materials: MaterialRow[]
  disabled: boolean
  /**
   * Món thuộc "Nhóm kèm thêm" (user chốt 2026-11-25): bật công thức thì chỉ gắn MỘT nguyên liệu (`mode = 'material'`);
   * nhóm thường thì nhiều nguyên liệu (`mode = 'recipe'`). Không còn thẻ chọn kiểu — một công tắc bật/tắt như "Có món bán
   * kèm". Món cũ đã lưu ở kiểu kia vẫn hiện đúng kiểu đã lưu để người dùng thấy và tắt/sửa (chế độ lấy từ `draft.mode`).
   */
  toppingGroup?: boolean
}) {
  const setLine = (key: string, patch: Partial<RecipeDraft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })

  return (
    <>
      <Switch
        checked={draft.mode !== 'none'}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(setRecipeEnabled(draft, checked, Boolean(toppingGroup)))}
        label="Công thức nguyên liệu"
        description={
          toppingGroup
            ? 'Món kèm thêm này trừ kho một nguyên liệu khi bán.'
            : 'Khi bán món này, hệ thống tự trừ kho các nguyên liệu bên dưới (ví dụ trà sữa trừ trà, sữa, đường).'
        }
      />

      {draft.mode === 'recipe' ? (
        // Dạng bảng cột (user chốt 2026-11-25): tiêu đề cột có icon một lần ở trên, mỗi dòng chỉ còn ô nhập trơn — không lặp
        // nhãn "icon + chữ" trong từng ô. Đơn vị của nguyên liệu đã nằm trong tên ở ô chọn ("vắt mì (gói)").
        <div className="inv-lines inv-recipe">
          <div className="inv-recipe__row inv-recipe__head">
            <span className="inv-recipe__th">
              <Package size={16} weight="bold" aria-hidden="true" />
              Nguyên liệu
            </span>
            <span className="inv-recipe__th inv-recipe__th--end" title="Định lượng nguyên liệu cho 1 phần">
              <Scales size={16} weight="bold" aria-hidden="true" />
              Định lượng / phần
            </span>
            <span className="inv-recipe__th inv-recipe__th--end" title="Hao hụt, tính theo phần trăm">
              <TrendDown size={16} weight="bold" aria-hidden="true" />
              Hao hụt (%)
            </span>
            <span />
          </div>
          {draft.lines.map((line) => {
            const material = materials.find((m) => m.materialId === line.materialId)
            return (
              <div className="inv-recipe__row" key={line.key}>
                <Select
                  className="ds-input"
                  aria-label="Nguyên liệu"
                  value={line.materialId}
                  disabled={disabled}
                  onChange={(e) => setLine(line.key, { materialId: Number(e.target.value) })}
                >
                  <option value={0}>Chọn nguyên liệu…</option>
                  {materials.map((m) => (
                    <option key={m.materialId} value={m.materialId}>
                      {m.name}
                      {m.unit ? ` (${m.unit})` : ''}
                    </option>
                  ))}
                </Select>
                <input
                  className="ds-input inv-recipe__num"
                  inputMode="decimal"
                  aria-label="Định lượng nguyên liệu cho 1 phần"
                  title={material?.unit ? `${material.unit} cho 1 phần` : undefined}
                  placeholder="0"
                  value={line.qty}
                  disabled={disabled}
                  onChange={(e) => setLine(line.key, { qty: e.target.value })}
                />
                <input
                  className="ds-input inv-recipe__num"
                  inputMode="decimal"
                  aria-label="Hao hụt phần trăm"
                  placeholder="0"
                  value={line.waste}
                  disabled={disabled}
                  onChange={(e) => setLine(line.key, { waste: e.target.value })}
                />
                <IconButton
                  label={material ? `Bỏ nguyên liệu ${material.name}` : 'Bỏ dòng nguyên liệu'}
                  icon={<Trash size={16} weight="bold" />}
                  disabled={disabled}
                  onClick={() => onChange({ ...draft, lines: draft.lines.filter((l) => l.key !== line.key) })}
                />
              </div>
            )
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...draft,
                  lines: [...draft.lines, { key: nextDraftKey(), materialId: 0, qty: '', waste: '' }],
                })
              }
            >
              Thêm nguyên liệu
            </Button>
          </div>
        </div>
      ) : null}

      {draft.mode === 'material' ? (
        // Một nguyên liệu duy nhất: bảng một cột, không có nút thêm/xóa dòng (tắt công tắc là gỡ).
        <div className="inv-lines inv-recipe inv-recipe--single">
          <div className="inv-recipe__row inv-recipe__head">
            <span className="inv-recipe__th" title="Nguyên liệu mà món này đại diện, dùng làm topping nhóm kèm thêm">
              <Package size={16} weight="bold" aria-hidden="true" />
              Nguyên liệu
            </span>
          </div>
          <div className="inv-recipe__row">
            <Select
              className="ds-input"
              aria-label="Nguyên liệu mà món này đại diện"
              value={draft.materialId}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, materialId: Number(e.target.value) })}
            >
              <option value={0}>Chọn nguyên liệu…</option>
              {materials.map((m) => (
                <option key={m.materialId} value={m.materialId}>
                  {m.name}
                  {m.unit ? ` (${m.unit})` : ''}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** Danh sách món bán kèm + cách chọn. Bật/tắt "có món bán kèm" do nơi dùng quyết định (xem `draft.enabled`). */
export function ToppingFields({
  draft,
  onChange,
  services,
  selfId,
  disabled,
}: {
  draft: ToppingDraft
  onChange: (next: ToppingDraft) => void
  services: ServiceItem[]
  /** Id món đang cấu hình (0 = món mới chưa có id) — loại khỏi danh sách chọn. */
  selfId: number
  disabled: boolean
}) {
  // Chỉ món thuộc "Nhóm kèm thêm" mới chọn làm món bán kèm được (user chốt 2026-11-25). Dòng đã lưu từ trước mà món đó không
  // còn ở nhóm kèm thêm vẫn được giữ trong danh sách để ô chọn không hiện trống. Server cũ chưa trả `groupTypeId` ⇒ không
  // phân biệt được nhóm ⇒ không lọc (như `canFilterTopping` của trang danh mục).
  const canFilterByGroup = services.some((s) => s.groupTypeId !== undefined)
  const chosen = new Set(draft.lines.map((l) => l.serviceId))
  const options = services.filter(
    (s) =>
      s.id !== selfId &&
      // Dòng đã lưu mà món bán kèm giờ ngừng bán vẫn phải có trong danh sách (không thì ô chọn hiện trống, giá hiện —).
      (s.active !== 0 || chosen.has(s.id)) &&
      (!canFilterByGroup || s.groupTypeId === GROUP_TYPE_TOPPING || chosen.has(s.id)),
  )
  const setLine = (key: string, patch: Partial<ToppingDraft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })

  return (
    <>
      {/* Không còn lựa chọn "Chọn nhiều / Chọn một" (user chốt 2026-11-25): server không xử lý khác nhau, chỉ là cờ hiển thị
          `isSelect`. Giá trị của `draft.single` được GIỮ NGUYÊN khi lưu (món cấu hình sẵn từ iCafe là "chọn một" vẫn là
          "chọn một"), món mới mặc định 0 = chọn nhiều. */}
      {/* Cùng kiểu bảng cột với công thức nguyên liệu (user chốt 2026-11-25). */}
      <div className="inv-lines inv-recipe">
        <div className="inv-recipe__row inv-recipe__head">
          <span className="inv-recipe__th">
            <ForkKnife size={16} weight="bold" aria-hidden="true" />
            Món bán kèm
          </span>
          <span className="inv-recipe__th inv-recipe__th--end" title="Lượng của món bán kèm cho 1 phần">
            <Scales size={16} weight="bold" aria-hidden="true" />
            Lượng / phần
          </span>
          <span className="inv-recipe__th inv-recipe__th--end" title="Giá của món bán kèm (lấy từ giá bán của món, không sửa ở đây)">
            <Money size={16} weight="bold" aria-hidden="true" />
            Giá bán kèm
          </span>
          <span />
        </div>
        {draft.lines.map((line) => {
          const service = options.find((s) => s.id === line.serviceId)
          return (
            <div className="inv-recipe__row" key={line.key}>
              <Select
                className="ds-input"
                aria-label="Món bán kèm"
                value={line.serviceId}
                disabled={disabled}
                onChange={(e) => setLine(line.key, { serviceId: Number(e.target.value) })}
              >
                <option value={0}>Chọn món bán kèm…</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.unit ? ` (${s.unit})` : ''}
                  </option>
                ))}
              </Select>
              <input
                className="ds-input inv-recipe__num"
                inputMode="decimal"
                aria-label="Lượng món bán kèm cho 1 phần"
                placeholder="1"
                value={line.qty}
                disabled={disabled}
                onChange={(e) => setLine(line.key, { qty: e.target.value })}
              />
              {/* Chỉ hiển thị (user chốt 2026-11-25): giá bán kèm thực tế = giá bán của món bán kèm (`isPrice=0`, xem
                  ARCHITECT/ICAFE_ORDER_SQL_CONTRACT.md §Q3) nên không nhập ở đây. `line.price` (topPrice đã lưu từ trước) vẫn
                  được giữ nguyên khi lưu, chỉ là không hiện và không sửa. */}
              <span className="inv-recipe__readonly" aria-label="Giá bán kèm">
                {service ? formatMoney(service.price) : '—'}
              </span>
              <IconButton
                label={service ? `Bỏ món bán kèm ${service.name}` : 'Bỏ dòng món bán kèm'}
                icon={<Trash size={16} weight="bold" />}
                disabled={disabled}
                onClick={() => onChange({ ...draft, lines: draft.lines.filter((l) => l.key !== line.key) })}
              />
            </div>
          )
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange({ ...draft, lines: [...draft.lines, { key: nextDraftKey(), serviceId: 0, qty: '', price: '' }] })
            }
          >
            Thêm món bán kèm
          </Button>
        </div>
      </div>
      <InlineAlert tone="info">
        Món bán kèm phải là món không có công thức hoặc món đã gắn một nguyên liệu; món có công thức bán kèm sẽ không
        trừ kho nên máy chủ từ chối.
      </InlineAlert>
    </>
  )
}
