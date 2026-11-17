import type { MaterialRow } from '../../api/inventory'
import type { ServiceItem } from '../../api/services'
import { Button, InlineAlert, Segmented, Select } from '../../design-system/components'
import { nextDraftKey, type RecipeDraft, type RecipeMode, type ToppingDraft } from './recipeDraftModel'
import './inventory.css'

// Ô nhập công thức + món bán kèm (controlled, không có nút Lưu). Dùng ở tab Công thức/Kho (mỗi khối tự lưu)
// và ở form Thêm/Sửa dịch vụ (lưu cùng lần bấm "Lưu"). Kiểu dáng `.inv-*` nằm trong inventory.css.

export function RecipeFields({
  draft,
  onChange,
  materials,
  disabled,
}: {
  draft: RecipeDraft
  onChange: (next: RecipeDraft) => void
  materials: MaterialRow[]
  disabled: boolean
}) {
  const setLine = (key: string, patch: Partial<RecipeDraft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })

  return (
    <>
      <Segmented<RecipeMode>
        ariaLabel="Kiểu công thức"
        value={draft.mode}
        disabled={disabled}
        onChange={(mode) => {
          const lines =
            mode === 'recipe' && draft.lines.length === 0
              ? [{ key: nextDraftKey(), materialId: 0, qty: '', waste: '' }]
              : draft.lines
          onChange({ ...draft, mode, lines })
        }}
        options={[
          { value: 'none', label: 'Không có công thức' },
          { value: 'recipe', label: 'Nhiều nguyên liệu' },
          { value: 'material', label: 'Món này là nguyên liệu' },
        ]}
      />

      {draft.mode === 'recipe' ? (
        <div className="inv-lines">
          <div className="inv-lines__head" aria-hidden="true">
            <span>Nguyên liệu</span>
            <span>Định lượng / 1 phần</span>
            <span>Hao hụt %</span>
            <span />
          </div>
          {draft.lines.map((line) => {
            const unit = materials.find((m) => m.materialId === line.materialId)?.unit
            return (
              <div className="inv-lines__row" key={line.key}>
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
                <span className="inv-lines__qty">
                  <input
                    className="ds-input"
                    inputMode="decimal"
                    aria-label="Định lượng"
                    value={line.qty}
                    disabled={disabled}
                    onChange={(e) => setLine(line.key, { qty: e.target.value })}
                  />
                  {unit ? <small className="inv-muted">{unit}</small> : null}
                </span>
                <input
                  className="ds-input"
                  inputMode="decimal"
                  aria-label="Hao hụt phần trăm"
                  placeholder="0"
                  value={line.waste}
                  disabled={disabled}
                  onChange={(e) => setLine(line.key, { waste: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onChange({ ...draft, lines: draft.lines.filter((l) => l.key !== line.key) })}
                >
                  Bỏ
                </Button>
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
        <label className="ds-field inv-direct">
          <span className="ds-field__label">Nguyên liệu mà món này đại diện (dùng làm topping nhóm 2)</span>
          <Select
            className="ds-input"
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
        </label>
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
  const options = services.filter((s) => s.id !== selfId && s.active !== 0)
  const setLine = (key: string, patch: Partial<ToppingDraft['lines'][number]>) =>
    onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })

  return (
    <>
      <Segmented<'0' | '1'>
        ariaLabel="Cách chọn món bán kèm"
        value={String(draft.single) as '0' | '1'}
        disabled={disabled}
        onChange={(next) => onChange({ ...draft, single: next === '1' ? 1 : 0 })}
        options={[
          { value: '0', label: 'Chọn nhiều' },
          { value: '1', label: 'Chọn một' },
        ]}
      />
      <div className="inv-lines">
        {draft.lines.length > 0 ? (
          <div className="inv-lines__head" aria-hidden="true">
            <span>Món bán kèm</span>
            <span>Lượng nguyên liệu / 1 phần</span>
            <span>Giá bán kèm (đ)</span>
            <span />
          </div>
        ) : null}
        {draft.lines.map((line) => (
          <div className="inv-lines__row" key={line.key}>
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
              className="ds-input"
              inputMode="decimal"
              aria-label="Lượng nguyên liệu mỗi phần"
              placeholder="1"
              value={line.qty}
              disabled={disabled}
              onChange={(e) => setLine(line.key, { qty: e.target.value })}
            />
            <input
              className="ds-input"
              inputMode="decimal"
              aria-label="Giá bán kèm"
              placeholder="0"
              value={line.price}
              disabled={disabled}
              onChange={(e) => setLine(line.key, { price: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange({ ...draft, lines: draft.lines.filter((l) => l.key !== line.key) })}
            >
              Bỏ
            </Button>
          </div>
        ))}
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
