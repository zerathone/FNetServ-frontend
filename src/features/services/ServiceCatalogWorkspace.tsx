import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { CookingPot, ListChecks, MagnifyingGlass, Package, Plus, TrayArrowDown } from '@phosphor-icons/react'
import { getServiceGroups, setServiceActive } from '../../api/serviceCatalog'
import { getServicesWithRecipe, type ServiceItem } from '../../api/services'
import {
  Button,
  ConfirmAction,
  ListPagination,
  ListToolbar,
  PageHeader,
  RefreshButton,
  Segmented,
  Select,
  SortHeaderCell,
  StateView,
  StatusBadge,
  Switch,
  type SegmentedOption,
} from '../../design-system/components'
import { sortRows, type SortState, type SortValue } from '../../lib/tableSort'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { FinishedTab } from '../inventory/FinishedTab'
import { ImportVoucherDialog, StocktakeVoucherDialog } from '../inventory/FinishedVoucherDialogs'
import { diffBadge, formatInt, MAX_BATCH_LINES, stockDiff } from '../inventory/finishedStockModel'
import { UnitsDialog } from '../inventory/MaterialDialogs'
import { GroupsDialog, PendingOrdersDialog, ServiceEditorDialog } from './ServiceCatalogDialogs'
import { ServiceRecipeTags, ServiceToppingTags } from './ServiceRecipeTags'
import { formatAmount, hasRecipeConfig, hasToppingConfig, serviceStockView } from './serviceStockEstimate'
import { ServiceThumb } from './ServiceThumb'
import {
  compareGroups,
  describeCatalogError,
  GROUP_TYPE_TOPPING,
  isDiscontinued,
  isReadonlyService,
  RIGHT_SERVICE_ADD,
  RIGHT_SERVICE_DISABLE,
  RIGHT_SERVICE_EDIT,
  RIGHT_SERVICE_GROUP,
  type PendingOrdersInfo,
} from './serviceCatalogModel'
import {
  matchesServiceStock,
  serviceStockLabel,
  type ServiceStockFilter,
} from './serviceModel'
import './services.css'

const PAGE_SIZE = 50

// Tab trong `?tab=`: Dịch vụ (mặc định, danh sách mặt hàng) | Quản lý tồn (tồn kho, nhập kho, kiểm kê, lịch sử phiếu).
type Tab = 'services' | 'stock'
const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'services', label: 'Dịch vụ' },
  { value: 'stock', label: 'Quản lý tồn' },
]

// Bộ lọc trạng thái bán: mở bán (đang bán) | ngừng bán.
type SaleFilter = 'all' | 'on' | 'off'

type ServiceSortKey = 'price' | 'stock' | 'expected'

/** Món không quản lý tồn không có số tồn / dự kiến ⇒ null ⇒ luôn xếp cuối dù tăng hay giảm. */
const SERVICE_SORT: Record<ServiceSortKey, (s: ServiceItem) => SortValue> = {
  price: (s) => s.price,
  // Cùng số với cột hiển thị: món vừa quản lý tồn vừa có công thức lấy số nhỏ hơn (serviceStockEstimate.ts).
  stock: (s) => {
    if (s.inventoryManagement !== 1) return null
    const view = serviceStockView(s)
    return view.kind === 'managed' ? view.amount : s.inventory
  },
  expected: (s) => (s.inventoryManagement === 1 ? s.inventoryExpected : null),
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function ServiceCatalogWorkspace() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'stock' ? 'stock' : 'services'
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<ServiceStockFilter>('all')
  // Lọc theo trạng thái bán, độc lập với lọc tồn kho (chọn cả hai = giao của hai điều kiện).
  const [saleFilter, setSaleFilter] = useState<SaleFilter>('all')
  // Chỉ hiện món bán kèm (thuộc nhóm topping); độc lập với hai bộ lọc trên.
  const [toppingOnly, setToppingOnly] = useState(false)
  // Chỉ hiện món CÓ công thức nguyên liệu / CÓ món bán kèm (khác `toppingOnly`: món thuộc nhóm kèm thêm); độc lập với các bộ lọc khác.
  const [recipeOnly, setRecipeOnly] = useState(false)
  const [withToppingsOnly, setWithToppingsOnly] = useState(false)
  // Lọc theo nhóm: 0 = mọi nhóm, còn lại = groupId.
  const [groupFilter, setGroupFilter] = useState(0)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<SortState<ServiceSortKey>>(null)
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canAdd = hasRight(RIGHT_SERVICE_ADD)
  const canEdit = hasRight(RIGHT_SERVICE_EDIT)
  const canDisable = hasRight(RIGHT_SERVICE_DISABLE)
  const canGroup = hasRight(RIGHT_SERVICE_GROUP)
  // Nhập kho / Kiểm kê mặt hàng có quản lý tồn — cùng quyền với tab Quản lý tồn (64 nhập, 68 kiểm kê).
  const canImport = hasRight(64)
  const canStocktake = hasRight(68)
  // `ids` = các mặt hàng điền sẵn vào lưới phiếu (một món từ nút ở dòng, nhiều món từ ô tick).
  const [stockDialog, setStockDialog] = useState<{ kind: 'import' | 'stocktake'; ids: number[] } | null>(null)
  // Tick chọn nhiều mặt hàng (chỉ món có quản lý tồn, không phải dòng hệ thống) để lập phiếu nhập / kiểm kê một lần.
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  // editor: undefined = đóng, null = thêm mới, ServiceItem = sửa món đó.
  const [editor, setEditor] = useState<ServiceItem | null | undefined>(undefined)
  const [groupsOpen, setGroupsOpen] = useState(false)
  // Đơn vị tính dùng chung cho dịch vụ và nguyên liệu ⇒ nút nằm ở đầu trang này và ở tab Nguyên liệu của trang Kho.
  const canUnit = hasRight(67)
  const [unitsOpen, setUnitsOpen] = useState(false)
  const unitsButton = (
    <Button
      type="button"
      variant="outline"
      disabled={!canUnit}
      title={canUnit ? 'Danh sách đơn vị tính dùng chung cho dịch vụ và nguyên liệu' : 'Cần quyền Quản lý đơn vị tính (67)'}
      onClick={() => setUnitsOpen(true)}
    >
      Đơn vị tính
    </Button>
  )
  const unitsDialog = <UnitsDialog open={unitsOpen} canEdit={canUnit} onClose={() => setUnitsOpen(false)} />

  const [toggling, setToggling] = useState<ServiceItem | null>(null)
  const [pending, setPending] = useState<{ info: PendingOrdersInfo; serviceName: string } | null>(null)
  const activeMutation = useMutation({
    mutationFn: (body: { serviceId: number; active: boolean }) => setServiceActive(body),
    onSuccess: (_result, body) => {
      pushToast(body.active ? 'Đã bán lại dịch vụ.' : 'Đã ngừng bán dịch vụ.', 'success')
      setToggling(null)
      void queryClient.invalidateQueries({ queryKey: ['services'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => {
      setToggling(null)
      pushToast(describeCatalogError(error), 'error')
    },
  })
  const servicesQuery = useQuery({
    // Khoá riêng: dữ liệu kèm công thức (`?include=recipe`) khác hình dạng với `['services']` của menu/kho/combo.
    // Vẫn nằm dưới ['services'] ⇒ mọi `invalidateQueries(['services'])` sau khi lưu món/công thức làm mới trang này.
    queryKey: ['services', 'catalog'],
    queryFn: getServicesWithRecipe,
    // Tab "Quản lý tồn" (FinishedTab) có query riêng nhẹ hơn (`useFinishedServices`) và không dùng dữ liệu này ⇒ không chạy các
    // câu SQL công thức / bán kèm / tồn nguyên liệu khi đang ở tab đó (quay lại tab Dịch vụ thì tải lại).
    enabled: tab === 'services',
  })

  const groupsQuery = useQuery({ queryKey: ['services', 'groups'], queryFn: getServiceGroups })

  const groupRows = groupsQuery.data?.rows
  // Server cũ chưa trả groupId / chưa có bảng nhóm ⇒ không hiện ô lọc (và không ẩn dịch vụ hệ thống, xem `source`).
  const canFilterGroup = (groupRows?.length ?? 0) > 0
  // Dịch vụ HỆ THỐNG = món không thuộc nhóm nào (groupId 0/thiếu, hoặc server đánh `readonly`: LEFT JOIN không thấy nhóm,
  // vd FFOOD) ⇒ KHÔNG liệt kê ở danh mục Dịch vụ & hàng hóa (không đếm, không lọc, không hiện).
  // CHỈ áp dụng khi hệ thống có nhóm: DB chưa có bảng nhóm thì server đánh `readonly` cho MỌI món, ẩn theo quy tắc sẽ làm
  // danh sách trống.
  const source = useMemo(() => {
    const all = servicesQuery.data ?? []
    if (!canFilterGroup) return all
    return all.filter((service) => !isReadonlyService(service) && !!service.groupId && service.groupId > 0)
  }, [servicesQuery.data, canFilterGroup])
  const groupOptions = useMemo(() => {
    const counts = new Map<number, number>()
    for (const service of source) {
      if (service.groupId && service.groupId > 0) counts.set(service.groupId, (counts.get(service.groupId) ?? 0) + 1)
    }
    const groups = [...(groupRows ?? [])].sort(compareGroups)
    return { groups, counts }
  }, [source, groupRows])
  const normalizedSearch = search.trim().toLocaleLowerCase('vi')
  // Sắp xếp theo cột số (giá bán, tồn kho, dự kiến) ở header — trên toàn danh sách đang lọc, trước khi cắt trang.
  const services = sortRows(
    source.filter(
      (service) =>
        matchesServiceStock(service, stockFilter) &&
        (saleFilter === 'all' || (saleFilter === 'off') === isDiscontinued(service)) &&
        (!toppingOnly || service.groupTypeId === GROUP_TYPE_TOPPING) &&
        (!recipeOnly || hasRecipeConfig(service)) &&
        (!withToppingsOnly || hasToppingConfig(service)) &&
        (groupFilter === 0|| service.groupId === groupFilter) &&
        (!normalizedSearch ||
          service.name.toLocaleLowerCase('vi').includes(normalizedSearch) ||
          service.unit.toLocaleLowerCase('vi').includes(normalizedSearch)),
    ),
    sort,
    SERVICE_SORT,
  )
  const changeSort = (next: SortState<ServiceSortKey>) => {
    setSort(next)
    setPage(0)
  }
  const totalPages = Math.max(1, Math.ceil(services.length / PAGE_SIZE))
  const visibleServices = services.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const isSelectable = (service: ServiceItem) => service.inventoryManagement === 1 && !isReadonlyService(service)
  // Chỉ tính món ĐANG HIỂN THỊ theo bộ lọc (mọi trang) và còn quản lý tồn ⇒ "k / Tổng" luôn khớp thứ nhìn thấy; món đã tick
  // nhưng đang bị lọc ẩn thì giữ trong lựa chọn, hiện lại khi bỏ lọc, và không đưa vào phiếu.
  const selectedIds = services.filter((service) => selected.has(service.id) && isSelectable(service)).map((service) => service.id)
  const selectableOnPage = visibleServices.filter(isSelectable)
  const allPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((service) => selected.has(service.id))
  const somePageSelected = selectableOnPage.some((service) => selected.has(service.id))
  const toggleSelected = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // "Chọn tất cả" chỉ áp cho các dòng chọn được của TRANG đang xem; lựa chọn ở trang khác giữ nguyên.
  const togglePage = () =>
    setSelected((current) => {
      const next = new Set(current)
      for (const service of selectableOnPage) {
        if (allPageSelected) next.delete(service.id)
        else next.add(service.id)
      }
      return next
    })
  const availableCount = source.filter((service) => matchesServiceStock(service, 'available')).length
  const lowCount = source.filter((service) => matchesServiceStock(service, 'low')).length
  const outCount = source.filter((service) => matchesServiceStock(service, 'out')).length
  const notManagedCount = source.filter((service) => matchesServiceStock(service, 'not-managed')).length
  const offCount = source.filter((service) => isDiscontinued(service)).length
  const onCount = source.length - offCount
  const toppingCount = source.filter((service) => service.groupTypeId === GROUP_TYPE_TOPPING).length
  // Server cũ chưa trả groupTypeId ⇒ không phân biệt được topping ⇒ không hiện nút.
  const canFilterTopping = source.some((service) => service.groupTypeId !== undefined)
  // Công thức / món bán kèm đến từ `include=recipe,topping`; server cũ không trả ⇒ không hiện nút (không lọc ra danh sách trống).
  const recipeCount = source.filter(hasRecipeConfig).length
  const withToppingsCount = source.filter(hasToppingConfig).length
  const canFilterRecipe = source.some((service) => service.recipe !== undefined)
  const canFilterWithToppings = source.some((service) => service.toppings !== undefined)

  const toggleStock = (value: ServiceStockFilter) => {
    setStockFilter((current) => (current === value ? 'all' : value))
    setPage(0)
  }
  const toggleSale = (value: Exclude<SaleFilter, 'all'>) => {
    setSaleFilter((current) => (current === value ? 'all' : value))
    setPage(0)
  }
  const toggleTopping = () => {
    setToppingOnly((current) => !current)
    setPage(0)
  }
  const toggleRecipe = () => {
    setRecipeOnly((current) => !current)
    setPage(0)
  }
  const toggleWithToppings = () => {
    setWithToppingsOnly((current) => !current)
    setPage(0)
  }
  // Nút tổng "N mặt hàng": bỏ mọi bộ lọc trên thanh thống kê (tồn kho, trạng thái bán, topping, công thức, bán kèm).
  const resetStatFilters = () => {
    setStockFilter('all')
    setSaleFilter('all')
    setToppingOnly(false)
    setRecipeOnly(false)
    setWithToppingsOnly(false)
    setPage(0)
  }

  const hasActiveFilter =
    stockFilter !== 'all' ||
    saleFilter !== 'all' ||
    toppingOnly ||
    recipeOnly ||
    withToppingsOnly ||
    search.trim() !== '' ||
    groupFilter !== 0
  const clearFilters = () => {
    setStockFilter('all')
    setSaleFilter('all')
    setToppingOnly(false)
    setRecipeOnly(false)
    setWithToppingsOnly(false)
    setGroupFilter(0)
    setSearch('')
    setPage(0)
  }

  const tabs = (
    <Segmented<Tab>
      ariaLabel="Danh mục"
      value={tab}
      options={TAB_OPTIONS}
      onChange={(next) => setParams(next === 'services' ? {} : { tab: next }, { replace: true })}
    />
  )

  if (tab === 'stock') {
    return (
      <section className="service-workspace">
        <PageHeader
          eyebrow="Danh mục"
          title="Dịch vụ & hàng hóa"
          description="Tồn kho, phiếu nhập kho, kiểm kê và chốt kho của mặt hàng có quản lý tồn. Có thể nhập kho hoặc kiểm kê từng mặt hàng ngay ở tab Dịch vụ."
        />
        {tabs}
        <FinishedTab />
      </section>
    )
  }

  return (
    <section className="service-workspace">
      <PageHeader
        eyebrow="Danh mục"
        title="Dịch vụ & hàng hóa"
        description="Thêm, sửa, ngừng bán dịch vụ và quản lý nhóm. Không xoá hẳn — ngừng bán thì bật lại được."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={!canGroup}
              title={canGroup ? undefined : 'Cần quyền Quản lý nhóm dịch vụ (66)'}
              onClick={() => setGroupsOpen(true)}
            >
              Nhóm dịch vụ
            </Button>
            {unitsButton}
          </>
        }
      />
      {tabs}

      <section className="service-panel__summary" aria-label="Tóm tắt danh mục dịch vụ">
        <button
          type="button"
          className={`service-stat service-stat--total ${stockFilter === 'all' && saleFilter === 'all' && !toppingOnly && !recipeOnly && !withToppingsOnly ? 'is-active' : ''}`}
          onClick={resetStatFilters}
        >
          <strong>{new Intl.NumberFormat('vi-VN').format(source.length)}</strong>
          <span className="service-stat__label">mặt hàng</span>
        </button>
        <div className="service-stat-row">
          <button
            type="button"
            className={`service-stat ${stockFilter === 'available' ? 'is-active' : ''}`}
            onClick={() => toggleStock('available')}
          >
            <span className="service-stat__dot service-stat__dot--available" aria-hidden="true" />
            <span className="service-stat__label">Còn tồn</span>
            <strong>{availableCount}</strong>
          </button>
          <button
            type="button"
            className={`service-stat ${stockFilter === 'low' ? 'is-active' : ''}`}
            onClick={() => toggleStock('low')}
            title="Còn hàng nhưng đã chạm mức cảnh báo tồn"
          >
            <span className="service-stat__dot service-stat__dot--low" aria-hidden="true" />
            <span className="service-stat__label">Sắp hết</span>
            <strong>{lowCount}</strong>
          </button>
          <button
            type="button"
            className={`service-stat ${stockFilter === 'out' ? 'is-active' : ''}`}
            onClick={() => toggleStock('out')}
          >
            <span className="service-stat__dot service-stat__dot--out" aria-hidden="true" />
            <span className="service-stat__label">Hết tồn</span>
            <strong>{outCount}</strong>
          </button>
          <button
            type="button"
            className={`service-stat ${stockFilter === 'not-managed' ? 'is-active' : ''}`}
            onClick={() => toggleStock('not-managed')}
          >
            <span className="service-stat__dot service-stat__dot--not-managed" aria-hidden="true" />
            <span className="service-stat__label">Không quản lý tồn</span>
            <strong>{notManagedCount}</strong>
          </button>
        </div>
        {/* Nhóm lọc thứ hai (trạng thái bán), ngăn với nhóm tồn kho bằng đường kẻ dọc của .service-stat-row. */}
        <div className="service-stat-row">
          <button
            type="button"
            className={`service-stat ${saleFilter === 'on' ? 'is-active' : ''}`}
            onClick={() => toggleSale('on')}
          >
            <span className="service-stat__dot service-stat__dot--available" aria-hidden="true" />
            <span className="service-stat__label">Mở bán</span>
            <strong>{onCount}</strong>
          </button>
          <button
            type="button"
            className={`service-stat ${saleFilter === 'off' ? 'is-active' : ''}`}
            onClick={() => toggleSale('off')}
          >
            <span className="service-stat__dot service-stat__dot--stopped" aria-hidden="true" />
            <span className="service-stat__label">Ngừng bán</span>
            <strong>{offCount}</strong>
          </button>
        </div>
        {/* Nhóm lọc thứ ba: món bán kèm (topping), ngăn với nhóm trạng thái bán bằng đường kẻ dọc. */}
        {canFilterTopping ? (
          <div className="service-stat-row">
            <button
              type="button"
              className={`service-stat ${toppingOnly ? 'is-active' : ''}`}
              onClick={toggleTopping}
              title="Chỉ hiện món kèm thêm (thuộc nhóm topping)"
            >
              <span className="service-stat__dot service-stat__dot--topping" aria-hidden="true" />
              <span className="service-stat__label">Kèm thêm</span>
              <strong>{toppingCount}</strong>
            </button>
          </div>
        ) : null}
        {/* Nhóm lọc thứ tư: cấu hình của món — có công thức nguyên liệu / có món bán kèm (icon trùng với tag ở cột Mặt hàng). */}
        {canFilterRecipe || canFilterWithToppings ? (
          <div className="service-stat-row">
            {canFilterRecipe ? (
              <button
                type="button"
                className={`service-stat ${recipeOnly ? 'is-active' : ''}`}
                onClick={toggleRecipe}
                title="Chỉ hiện món có công thức nguyên liệu (nhiều nguyên liệu hoặc gắn một nguyên liệu)"
              >
                <CookingPot className="service-stat__icon" size={14} weight="bold" aria-hidden="true" />
                <span className="service-stat__label">Có công thức</span>
                <strong>{recipeCount}</strong>
              </button>
            ) : null}
            {canFilterWithToppings ? (
              <button
                type="button"
                className={`service-stat ${withToppingsOnly ? 'is-active' : ''}`}
                onClick={toggleWithToppings}
                title="Chỉ hiện món có món bán kèm"
              >
                <Plus className="service-stat__icon" size={14} weight="bold" aria-hidden="true" />
                <span className="service-stat__label">Có bán kèm</span>
                <strong>{withToppingsCount}</strong>
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="service-filters" aria-label="Lọc dịch vụ">
        <div className="ds-field service-filters__search">
          <div className="ds-input-group ds-input-group--search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                aria-label="Tìm tên hoặc đơn vị"
                placeholder="Ví dụ: mì, chai, phần…"
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(0)
                }}
              />
            </div>
          </div>
        </div>
        {canFilterGroup ? (
          <div className="ds-field service-filters__group">
            <div className="ds-input-group">
              <span className="ds-input-group-separator">Nhóm</span>
              <Select
                aria-label="Lọc theo nhóm dịch vụ"
                value={groupFilter}
                onChange={(event) => {
                  setGroupFilter(Number(event.target.value))
                  setPage(0)
                }}
              >
                <option value={0}>Tất cả</option>
                {groupOptions.groups.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.name} ({groupOptions.counts.get(group.groupId) ?? 0})
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
        <Button
          type="button"
          variant="primary"
          className="service-filters__add"
          disabled={!canAdd}
          title={canAdd ? undefined : 'Cần quyền Thêm dịch vụ (61)'}
          onClick={() => setEditor(null)}
        >
          Thêm mặt hàng
        </Button>
      </section>

      <section className="service-panel" aria-label="Danh sách dịch vụ">
        <ListToolbar
          count={
            selectedIds.length > 0 ? (
              // Có tick: "k / Tổng mặt hàng đã chọn" + nút thao tác ngay cạnh (thay cho chữ "Tổng N").
              <span className="inv-toolbar-selection" role="region" aria-label="Thao tác mặt hàng đã chọn">
                <span>
                  <strong>{formatInt(selectedIds.length)}</strong> / <strong>{formatInt(services.length)}</strong> mặt hàng đã chọn
                  {selectedIds.length > MAX_BATCH_LINES ? ` · phiếu chỉ nhận ${MAX_BATCH_LINES} món đầu` : ''}
                </span>
                <Button
                  type="button"
                  variant="primary"
                  icon={<TrayArrowDown size={18} weight="bold" aria-hidden="true" />}
                  disabled={!canImport}
                  title={canImport ? undefined : 'Cần quyền Quản lý kho (64)'}
                  onClick={() => setStockDialog({ kind: 'import', ids: selectedIds })}
                >
                  Nhập kho
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  icon={<ListChecks size={18} weight="bold" aria-hidden="true" />}
                  disabled={!canStocktake}
                  title={canStocktake ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                  onClick={() => setStockDialog({ kind: 'stocktake', ids: selectedIds })}
                >
                  Kiểm kê
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </Button>
              </span>
            ) : (
              <>Tổng <strong>{new Intl.NumberFormat('vi-VN').format(services.length)}</strong></>
            )
          }
          actions={
            <>
              <RefreshButton loading={servicesQuery.isFetching} onClick={() => void servicesQuery.refetch()} />
              <ListPagination
                page={page}
                totalPages={totalPages}
                canNext={page < totalPages - 1}
                onPrevious={() => setPage((value) => Math.max(0, value - 1))}
                onNext={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              />
            </>
          }
        />

        {servicesQuery.isLoading || groupsQuery.isLoading ? (
          <StateView title="Đang tải danh mục…" />
        ) : servicesQuery.isError ? (
          <StateView
            title="Không tải được danh mục"
            description={
              servicesQuery.error instanceof Error
                ? servicesQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void servicesQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : services.length === 0 ? (
          <StateView
            title={hasActiveFilter ? 'Không có dịch vụ phù hợp' : 'Chưa có dịch vụ nào'}
            description={hasActiveFilter ? 'Thử từ khóa hoặc bộ lọc khác.' : undefined}
            action={
              hasActiveFilter ? (
                <Button type="button" onClick={clearFilters}>
                  Xóa bộ lọc
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="service-list-region">
            <table className="service-table">
              <thead>
                <tr>
                  <th className="service-table__select">
                    <input
                      type="checkbox"
                      className="service-table__check"
                      aria-label="Chọn tất cả mặt hàng quản lý tồn trên trang"
                      title={selectableOnPage.length === 0 ? 'Không có mặt hàng quản lý tồn trên trang này' : undefined}
                      checked={allPageSelected}
                      disabled={selectableOnPage.length === 0}
                      ref={(el) => {
                        if (el) el.indeterminate = !allPageSelected && somePageSelected
                      }}
                      onChange={togglePage}
                    />
                  </th>
                  <th>Mặt hàng</th>
                  <th>Nhóm</th>
                  <SortHeaderCell label="Giá bán" sortKey="price" sort={sort} onSort={changeSort} className="is-num" />
                  <SortHeaderCell label="Tồn kho" sortKey="stock" sort={sort} onSort={changeSort} />
                  <SortHeaderCell label="Dự kiến / Chênh lệch" sortKey="expected" sort={sort} onSort={changeSort} />
                  <th className="service-table__sale">Mở bán</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {visibleServices.map((service) => {
                  // Tồn hiển thị: thành phẩm, hoặc ước lượng từ nguyên liệu (xem serviceStockEstimate.ts). Món vừa quản lý tồn
                  // vừa có công thức ⇒ lấy số nhỏ hơn, badge màu theo số hiệu dụng đó.
                  const stockView = serviceStockView(service)
                  const stock = serviceStockLabel(
                    stockView.kind === 'managed' ? { ...service, inventory: stockView.amount } : service,
                  )
                  const diffTag = diffBadge(stockDiff(service))
                  const system = isReadonlyService(service)
                  const stopped = isDiscontinued(service)
                  return (
                    <tr className={[stopped ? 'is-off' : '', selected.has(service.id) ? 'is-selected' : ''].filter(Boolean).join(' ') || undefined} key={service.id}>
                      <td className="service-table__select">
                        <input
                          type="checkbox"
                          className="service-table__check"
                          aria-label={`Chọn ${service.name}`}
                          title={isSelectable(service) ? undefined : 'Chỉ chọn được mặt hàng có quản lý tồn kho'}
                          checked={selected.has(service.id) && isSelectable(service)}
                          disabled={!isSelectable(service)}
                          onChange={() => toggleSelected(service.id)}
                        />
                      </td>
                      <td>
                        <div className="service-table__name">
                          <ServiceThumb service={service} />
                          <div className="service-table__text">
                            <div className="service-table__title">
                              <strong title={service.name}>{service.name}</strong>
                              {system ? (
                                <StatusBadge tone="info" title="Dòng do hệ thống tự tạo (vd FFOOD), không sửa ở màn này">
                                  Dịch vụ hệ thống
                                </StatusBadge>
                              ) : null}
                            </div>
                            {/* Dòng hệ thống (FFOOD…) không nằm trong danh mục công thức ⇒ khỏi gọi server. Công thức và món bán
                                kèm xếp CHỒNG trong một cột dồn phải ⇒ hai dòng thẳng mép phải với nhau theo cấu trúc. */}
                            {system ? null : (
                              <div className="service-table__tags">
                                <ServiceRecipeTags service={service} />
                                <ServiceToppingTags service={service} />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{service.groupName || <span className="svc-muted">Chưa có nhóm</span>}</td>
                      <td className="is-num">{formatMoney(service.price)}</td>
                      <td>
                        {/* Dạng: [số lượng] đơn vị — màu badge cho biết trạng thái, chữ trạng thái chỉ hiện ở tooltip.
                            Không quản lý tồn ⇒ badge trung tính, không chấm tròn, nội dung "—". */}
                        <div className="service-table__stock">
                          {stockView.kind === 'estimate' ? (
                            // Số ƯỚC LƯỢNG từ nguyên liệu (không phải sổ sách kho thành phẩm): icon nguyên liệu + dấu "~",
                            // khác badge của tồn thành phẩm để không bị nhầm.
                            <span
                              className={`service-table__estimate${stockView.amount <= 0 ? ' is-out' : ''}`}
                              title={`${stockView.amount <= 0 ? 'Hết nguyên liệu. ' : ''}${stockView.detail}`}
                            >
                              <Package size={14} weight="bold" aria-hidden="true" />
                              {stockView.amount <= 0 ? 'Hết' : `~${formatAmount(stockView.amount)}`}
                              {stockView.unit ? <small>{stockView.unit}</small> : null}
                            </span>
                          ) : (
                            <>
                              <StatusBadge
                                tone={stock.tone}
                                dot={stock.dot}
                                title={stockView.kind === 'managed' && stockView.detail ? `${stock.label}. ${stockView.detail}` : stock.label}
                              >
                                {service.inventoryManagement === 1
                                  ? new Intl.NumberFormat('vi-VN').format(stockView.kind === 'managed' ? stockView.amount : service.inventory)
                                  : '—'}
                              </StatusBadge>
                              {service.inventoryManagement === 1 ? <span>{service.unit}</span> : null}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        {/* Dự kiến = tồn sổ sách; Chênh lệch = Dự kiến − Thực tế (âm danger, dương warning, 0 để trống). Server cũ chưa trả inventoryExpected ⇒ —. */}
                        {service.inventoryManagement === 1 && service.inventoryExpected !== undefined ? (
                          <div className="service-table__stock">
                            <span>{formatInt(service.inventoryExpected)}</span>
                            {diffTag ? (
                              <StatusBadge tone={diffTag.tone} dot={false} title="Dự kiến − Thực tế">
                                {diffTag.text}
                              </StatusBadge>
                            ) : null}
                          </div>
                        ) : (
                          <span className="svc-muted">—</span>
                        )}
                      </td>
                      <td className="service-table__sale">
                        <span
                          className="service-table__switch"
                          title={
                            system
                              ? 'Dòng hệ thống, không đổi ở màn này'
                              : stopped
                                ? canEdit
                                  ? 'Đang ngừng bán — bật để bán lại'
                                  : 'Cần quyền Sửa dịch vụ (62)'
                                : canDisable
                                  ? 'Đang mở bán — tắt để ngừng bán'
                                  : 'Cần quyền Xoá/ngừng bán dịch vụ (63)'
                          }
                        >
                          <Switch
                            checked={!stopped}
                            disabled={
                              system || activeMutation.isPending || (stopped ? !canEdit : !canDisable)
                            }
                            aria-label={`${stopped ? 'Mở bán lại' : 'Ngừng bán'} ${service.name}`}
                            onCheckedChange={() =>
                              stopped
                                ? activeMutation.mutate({ serviceId: service.id, active: true })
                                : setToggling(service)
                            }
                          />
                        </span>
                      </td>
                      <td>
                        {system ? null : (
                          <div className="service-table__actions">
                            {/* Chỉ mặt hàng có quản lý tồn mới nhập kho / kiểm kê được. */}
                            {service.inventoryManagement === 1 ? (
                              <>
                                <Button
                                  type="button"
                                  variant="outline"
                                  icon={<TrayArrowDown size={18} weight="bold" aria-hidden="true" />}
                                  disabled={!canImport}
                                  title={canImport ? undefined : 'Cần quyền Quản lý kho (64)'}
                                  onClick={() => setStockDialog({ kind: 'import', ids: [service.id] })}
                                >
                                  Nhập kho
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  icon={<ListChecks size={18} weight="bold" aria-hidden="true" />}
                                  disabled={!canStocktake}
                                  title={canStocktake ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                                  onClick={() => setStockDialog({ kind: 'stocktake', ids: [service.id] })}
                                >
                                  Kiểm kê
                                </Button>
                              </>
                            ) : null}
                            <Button
                              type="button"
                              variant="warning-outline"
                              disabled={!canEdit}
                              title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
                              onClick={() => setEditor(service)}
                            >
                              Sửa
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ServiceEditorDialog
        open={editor !== undefined}
        service={editor ?? null}
        onClose={() => setEditor(undefined)}
        onPendingOrders={(info, serviceName) => setPending({ info, serviceName })}
      />
      <PendingOrdersDialog
        info={pending?.info ?? null}
        serviceName={pending?.serviceName ?? ''}
        onClose={() => setPending(null)}
      />
      <GroupsDialog open={groupsOpen} canEdit={canGroup} onClose={() => setGroupsOpen(false)} />
      {stockDialog?.kind === 'import' ? (
        <ImportVoucherDialog key={stockDialog.ids.join(',')} initialServiceIds={stockDialog.ids} onClose={() => setStockDialog(null)} />
      ) : null}
      {stockDialog?.kind === 'stocktake' ? (
        <StocktakeVoucherDialog key={stockDialog.ids.join(',')} initialServiceIds={stockDialog.ids} onClose={() => setStockDialog(null)} />
      ) : null}
      {unitsDialog}
      <ConfirmAction
        open={toggling !== null}
        title={`Ngừng bán [${toggling?.name ?? ''}]?`}
        description="Món bị ẩn khỏi menu bán. Lịch sử bán và công thức giữ nguyên, bật lại bất cứ lúc nào bằng cách bật lại công tắc ở cột “Mở bán”."
        confirmLabel="Ngừng bán"
        danger
        pending={activeMutation.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && activeMutation.mutate({ serviceId: toggling.id, active: false })}
      />
    </section>
  )
}
