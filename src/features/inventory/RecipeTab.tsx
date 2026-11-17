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
import { Button, InlineAlert, StateView, StatusBadge } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { describeInventoryError } from './inventoryModel'
import { RecipeFields, ToppingFields } from './RecipeFields'
import {
  recipeChanged,
  recipeDraftFromConfig,
  recipeSaveBody,
  toppingDraftFromConfig,
  toppingSaveBody,
  validateRecipe,
  validateTopping,
  type RecipeDraft,
  type ToppingDraft,
} from './recipeDraftModel'

/** Tab Công thức & món bán kèm: chọn món bên trái, cấu hình bên phải. Quyền 62 (sửa dịch vụ) cho cả hai. */
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
            description="Món có công thức sẽ tự trừ nguyên liệu khi bán; món bán kèm là món/nguyên liệu bán cùng."
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
          title="Cơ sở dữ liệu chưa có bảng công thức/món bán kèm"
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
            {configQuery.data.zTopping ? `${configQuery.data.zTopping} món bán kèm` : 'chưa có món bán kèm'}
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
  const [initial] = useState<RecipeDraft>(() => recipeDraftFromConfig(config))
  const [draft, setDraft] = useState<RecipeDraft>(initial)

  const mutation = useMutation({
    mutationFn: () => saveRecipe(recipeSaveBody(serviceId, draft)),
    ...useSaveInvalidate('Đã lưu công thức.'),
  })

  const inactive = config.recipe.filter((r) => r.materialActive !== 1)
  const problem = validateRecipe(draft)

  return (
    <div className="inv-block">
      <h3>Công thức nguyên liệu</h3>
      <RecipeFields draft={draft} onChange={setDraft} materials={materials} disabled={!canEdit} />
      {inactive.length > 0 ? (
        <InlineAlert tone="warning">
          Có nguyên liệu đã ngừng dùng trong công thức: {inactive.map((r) => r.materialName).join(', ')}. Bán món này sẽ
          bị chặn cho tới khi thay hoặc dùng lại nguyên liệu.
        </InlineAlert>
      ) : null}

      {draft.mode === 'none' && initial.mode !== 'none' ? (
        <InlineAlert tone="info">Lưu sẽ gỡ công thức hiện có; món này không còn trừ nguyên liệu khi bán.</InlineAlert>
      ) : null}

      <div className="inv-block__foot">
        {problem && draft.mode !== 'none' ? <span className="inv-error">{problem}</span> : <span />}
        <Button
          type="button"
          variant="primary"
          loading={mutation.isPending}
          disabled={!canEdit || problem !== null || !recipeChanged(initial, draft)}
          title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
          onClick={() => mutation.mutate()}
        >
          Lưu công thức
        </Button>
      </div>
    </div>
  )
}

// ===== Món bán kèm =====

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
  // Tab này không có công tắc bật/tắt: danh sách rỗng = không có món bán kèm.
  const [draft, setDraft] = useState<ToppingDraft>(() => ({ ...toppingDraftFromConfig(config), enabled: true }))

  const mutation = useMutation({
    mutationFn: () => saveToppings(toppingSaveBody(serviceId, draft)),
    ...useSaveInvalidate('Đã lưu món bán kèm.'),
  })

  const problem = draft.lines.length === 0 ? null : validateTopping(serviceId, draft)
  const changed = draft.lines.length > 0 || config.toppings.length > 0

  return (
    <div className="inv-block">
      <h3>Món bán kèm</h3>
      <ToppingFields draft={draft} onChange={setDraft} services={services} selfId={serviceId} disabled={!canEdit} />
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
          Lưu món bán kèm
        </Button>
      </div>
    </div>
  )
}
