import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import {
  getMaterials,
  getRecipeConfig,
  saveRecipe,
  saveToppings,
  type MaterialRow,
  type RecipeConfig,
} from '../../api/inventory'
import { getServices, type ServiceItem } from '../../api/services'
import { Button, InlineAlert, Segmented, Select, StateView, StatusBadge } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  describeInventoryError,
  recipeLinesBody,
  toppingLinesBody,
  validateRecipeDraft,
  validateToppingDraft,
  type RecipeDraftLine,
  type ToppingDraftLine,
} from './inventoryModel'

type RecipeMode = 'none' | 'recipe' | 'material'

let draftSeq = 0
const nextKey = () => `d${++draftSeq}`

/** Tab Công thức & topping: chọn món bên trái, cấu hình bên phải. Quyền 62 (sửa dịch vụ) cho cả hai. */
export function RecipeTab() {
  const [search, setSearch] = useState('')
  const [serviceId, setServiceId] = useState(0)
  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: getServices })

  const services = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    const all = servicesQuery.data ?? []
    return needle ? all.filter((s) => s.name.toLocaleLowerCase('vi').includes(needle)) : all
  }, [servicesQuery.data, search])

  return (
    <div className="inv-split">
      <section className="inv-panel inv-picker" aria-label="Chọn món">
        <div className="ds-search-input inv-filters__search">
          <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
          <input
            className="ds-input"
            type="search"
            value={search}
            aria-label="Tìm món"
            placeholder="Tìm món…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {servicesQuery.isLoading ? (
          <StateView title="Đang tải danh mục…" />
        ) : servicesQuery.isError ? (
          <StateView
            title="Không tải được danh mục dịch vụ"
            description={describeInventoryError(servicesQuery.error)}
            action={
              <Button type="button" onClick={() => void servicesQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : (
          <ul className="inv-picker__list">
            {services.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`inv-picker__item${s.id === serviceId ? ' is-active' : ''}${s.active === 0 ? ' is-off' : ''}`}
                  onClick={() => setServiceId(s.id)}
                >
                  <strong>{s.name}</strong>
                  <small className="inv-muted">
                    #{s.id}
                    {s.unit ? ` · ${s.unit}` : ''}
                    {s.active === 0 ? ' · ngừng bán' : ''}
                  </small>
                </button>
              </li>
            ))}
            {services.length === 0 ? <li className="inv-muted">Không có món phù hợp.</li> : null}
          </ul>
        )}
      </section>

      {serviceId === 0 ? (
        <section className="inv-panel">
          <StateView
            title="Chọn một món để cấu hình"
            description="Món có công thức sẽ tự trừ nguyên liệu khi bán; topping là món/nguyên liệu bán kèm."
          />
        </section>
      ) : (
        <ServiceConfig key={serviceId} serviceId={serviceId} services={servicesQuery.data ?? []} />
      )}
    </div>
  )
}

function ServiceConfig({ serviceId, services }: { serviceId: number; services: ServiceItem[] }) {
  const configQuery = useQuery({
    queryKey: ['inventory', 'recipe-config', serviceId],
    queryFn: () => getRecipeConfig(serviceId),
  })
  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: true, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: true, lowOnly: false, limit: 1000 }),
  })

  if (configQuery.isLoading) {
    return (
      <section className="inv-panel">
        <StateView title="Đang tải cấu hình…" />
      </section>
    )
  }
  if (configQuery.isError || !configQuery.data) {
    return (
      <section className="inv-panel">
        <StateView
          title="Không tải được cấu hình món"
          description={describeInventoryError(configQuery.error)}
          action={
            <Button type="button" onClick={() => void configQuery.refetch()}>
              Thử lại
            </Button>
          }
        />
      </section>
    )
  }
  if (!configQuery.data.supported) {
    return (
      <section className="inv-panel">
        <StateView
          title="Cơ sở dữ liệu chưa có bảng công thức/topping"
          description="Khởi động lại máy chủ để tạo bảng, rồi tải lại trang."
        />
      </section>
    )
  }
  const materials = materialsQuery.data?.rows ?? []
  // key theo thời điểm dữ liệu để bản nháp nạp lại đúng sau khi lưu.
  const version = configQuery.dataUpdatedAt
  return (
    <section className="inv-panel inv-config" aria-label="Cấu hình món">
      <header className="inv-config__head">
        <div>
          <h2>{configQuery.data.name}</h2>
          <p className="inv-muted">
            #{serviceId} · {configQuery.data.zRecipe ? `${configQuery.data.zRecipe} nguyên liệu` : 'chưa có công thức'} ·{' '}
            {configQuery.data.zTopping ? `${configQuery.data.zTopping} topping` : 'chưa có topping'}
          </p>
        </div>
        {configQuery.data.zType ? <StatusBadge tone="info">Trừ kho khi bán</StatusBadge> : null}
      </header>
      <RecipeEditor key={`r${version}`} serviceId={serviceId} config={configQuery.data} materials={materials} />
      <ToppingEditor key={`t${version}`} serviceId={serviceId} config={configQuery.data} services={services} />
    </section>
  )
}

function useSaveInvalidate(successText: string) {
  const queryClient = useQueryClient()
  return {
    onSuccess: () => {
      pushToast(successText, 'success')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error: unknown) => pushToast(describeInventoryError(error), 'error'),
  }
}

// ===== Công thức =====

function RecipeEditor({
  serviceId,
  config,
  materials,
}: {
  serviceId: number
  config: RecipeConfig
  materials: MaterialRow[]
}) {
  const canEdit = useAuthStore((s) => s.hasRight)(62)
  const initialMode: RecipeMode = (config.zMaterialId ?? 0) > 0 ? 'material' : config.recipe.length > 0 ? 'recipe' : 'none'
  const [mode, setMode] = useState<RecipeMode>(initialMode)
  const [lines, setLines] = useState<RecipeDraftLine[]>(() =>
    config.recipe.map((r) => ({
      key: nextKey(),
      materialId: r.materialId,
      qty: trimDecimal(r.qty),
      waste: trimDecimal(r.wastePercent),
    })),
  )
  const [directMaterial, setDirectMaterial] = useState(config.zMaterialId ?? 0)

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'material') return saveRecipe({ serviceId, materialId: directMaterial })
      return saveRecipe({ serviceId, lines: mode === 'recipe' ? recipeLinesBody(lines) : [] })
    },
    ...useSaveInvalidate('Đã lưu công thức.'),
  })

  const inactive = config.recipe.filter((r) => r.materialActive !== 1)
  const problem =
    mode === 'recipe'
      ? lines.length === 0
        ? 'Thêm ít nhất một nguyên liệu, hoặc chọn “Không có công thức”.'
        : validateRecipeDraft(lines)
      : mode === 'material' && directMaterial === 0
        ? 'Chọn nguyên liệu mà món này đại diện.'
        : null

  const setLine = (key: string, patch: Partial<RecipeDraftLine>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  return (
    <div className="inv-block">
      <h3>Công thức nguyên liệu</h3>
      <Segmented<RecipeMode>
        ariaLabel="Kiểu công thức"
        value={mode}
        disabled={!canEdit}
        onChange={(next) => {
          setMode(next)
          if (next === 'recipe' && lines.length === 0) {
            setLines([{ key: nextKey(), materialId: 0, qty: '', waste: '' }])
          }
        }}
        options={[
          { value: 'none', label: 'Không có công thức' },
          { value: 'recipe', label: 'Nhiều nguyên liệu' },
          { value: 'material', label: 'Món này là nguyên liệu' },
        ]}
      />
      {inactive.length > 0 ? (
        <InlineAlert tone="warning">
          Có nguyên liệu đã ngừng dùng trong công thức: {inactive.map((r) => r.materialName).join(', ')}. Bán món này sẽ
          bị chặn cho tới khi thay hoặc dùng lại nguyên liệu.
        </InlineAlert>
      ) : null}

      {mode === 'recipe' ? (
        <div className="inv-lines">
          <div className="inv-lines__head" aria-hidden="true">
            <span>Nguyên liệu</span>
            <span>Định lượng / 1 phần</span>
            <span>Hao hụt %</span>
            <span />
          </div>
          {lines.map((line) => {
            const unit = materials.find((m) => m.materialId === line.materialId)?.unit
            return (
              <div className="inv-lines__row" key={line.key}>
                <Select
                  className="ds-input"
                  aria-label="Nguyên liệu"
                  value={line.materialId}
                  disabled={!canEdit}
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
                    disabled={!canEdit}
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
                  disabled={!canEdit}
                  onChange={(e) => setLine(line.key, { waste: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
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
              disabled={!canEdit}
              onClick={() => setLines((cur) => [...cur, { key: nextKey(), materialId: 0, qty: '', waste: '' }])}
            >
              Thêm nguyên liệu
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'material' ? (
        <label className="ds-field inv-direct">
          <span className="ds-field__label">Nguyên liệu mà món này đại diện (dùng làm topping nhóm 2)</span>
          <Select
            className="ds-input"
            value={directMaterial}
            disabled={!canEdit}
            onChange={(e) => setDirectMaterial(Number(e.target.value))}
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

      {mode === 'none' && initialMode !== 'none' ? (
        <InlineAlert tone="info">Lưu sẽ gỡ công thức hiện có; món này không còn trừ nguyên liệu khi bán.</InlineAlert>
      ) : null}

      <div className="inv-block__foot">
        {problem && mode !== 'none' ? <span className="inv-error">{problem}</span> : <span />}
        <Button
          type="button"
          variant="primary"
          loading={mutation.isPending}
          disabled={!canEdit || problem !== null || (mode === 'none' && initialMode === 'none')}
          title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
          onClick={() => mutation.mutate()}
        >
          Lưu công thức
        </Button>
      </div>
    </div>
  )
}

// ===== Topping =====

function ToppingEditor({
  serviceId,
  config,
  services,
}: {
  serviceId: number
  config: RecipeConfig
  services: ServiceItem[]
}) {
  const canEdit = useAuthStore((s) => s.hasRight)(62)
  const [single, setSingle] = useState<0 | 1>(config.isSelect === 1 ? 1 : 0)
  const [lines, setLines] = useState<ToppingDraftLine[]>(() =>
    config.toppings.map((t) => ({
      key: nextKey(),
      serviceId: t.serviceId,
      qty: trimDecimal(t.toppingQty),
      price: trimDecimal(t.topPrice),
    })),
  )

  const mutation = useMutation({
    mutationFn: () => saveToppings({ serviceId, isSelect: single, toppings: toppingLinesBody(lines) }),
    ...useSaveInvalidate('Đã lưu topping.'),
  })

  const options = services.filter((s) => s.id !== serviceId && s.active !== 0)
  const problem = validateToppingDraft(serviceId, lines)
  const setLine = (key: string, patch: Partial<ToppingDraftLine>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const changed = lines.length > 0 || config.toppings.length > 0

  return (
    <div className="inv-block">
      <h3>Topping bán kèm</h3>
      <Segmented<'0' | '1'>
        ariaLabel="Cách chọn topping"
        value={String(single) as '0' | '1'}
        disabled={!canEdit}
        onChange={(next) => setSingle(next === '1' ? 1 : 0)}
        options={[
          { value: '0', label: 'Chọn nhiều' },
          { value: '1', label: 'Chọn một' },
        ]}
      />
      <div className="inv-lines">
        {lines.length > 0 ? (
          <div className="inv-lines__head" aria-hidden="true">
            <span>Topping</span>
            <span>Lượng nguyên liệu / 1 topping</span>
            <span>Giá topping (đ)</span>
            <span />
          </div>
        ) : null}
        {lines.map((line) => (
          <div className="inv-lines__row" key={line.key}>
            <Select
              className="ds-input"
              aria-label="Topping"
              value={line.serviceId}
              disabled={!canEdit}
              onChange={(e) => setLine(line.key, { serviceId: Number(e.target.value) })}
            >
              <option value={0}>Chọn topping…</option>
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
              aria-label="Lượng nguyên liệu mỗi topping"
              placeholder="1"
              value={line.qty}
              disabled={!canEdit}
              onChange={(e) => setLine(line.key, { qty: e.target.value })}
            />
            <input
              className="ds-input"
              inputMode="decimal"
              aria-label="Giá topping"
              placeholder="0"
              value={line.price}
              disabled={!canEdit}
              onChange={(e) => setLine(line.key, { price: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              disabled={!canEdit}
              onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
            >
              Bỏ
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit}
            onClick={() => setLines((cur) => [...cur, { key: nextKey(), serviceId: 0, qty: '', price: '' }])}
          >
            Thêm topping
          </Button>
        </div>
      </div>
      <InlineAlert tone="info">
        Topping phải là món không có công thức hoặc món đã gắn một nguyên liệu; món có công thức bán kèm sẽ không trừ
        kho nên máy chủ từ chối.
      </InlineAlert>
      <div className="inv-block__foot">
        {problem ? <span className="inv-error">{problem}</span> : <span />}
        <Button
          type="button"
          variant="primary"
          loading={mutation.isPending}
          disabled={!canEdit || problem !== null || !changed}
          title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
          onClick={() => mutation.mutate()}
        >
          Lưu topping
        </Button>
      </div>
    </div>
  )
}

/** "1.500" → "1.5", "0.000" → "" để đưa vào ô nhập. */
function trimDecimal(value: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!m) return value
  const frac = (m[2] ?? '').replace(/0+$/, '')
  const out = frac ? `${m[1]}.${frac}` : m[1]
  return out === '0' ? '' : out
}
