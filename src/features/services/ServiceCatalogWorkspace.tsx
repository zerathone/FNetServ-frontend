import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { setServiceActive } from '../../api/serviceCatalog'
import { getServices, type ServiceItem } from '../../api/services'
import {
  Button,
  ConfirmAction,
  ListPagination,
  ListToolbar,
  PageHeader,
  RefreshButton,
  Segmented,
  StateView,
  StatusBadge,
  type SegmentedOption,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { MaterialsTab } from '../inventory/MaterialsTab'
import { GroupsDialog, PendingOrdersDialog, ServiceEditorDialog } from './ServiceCatalogDialogs'
import {
  describeCatalogError,
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

const PAGE_SIZE = 24

// Tab trong `?tab=`: dịch vụ (mặc định) | nguyên liệu (danh mục + tồn + nhập/xuất/kiểm kê, quản lý dạng danh sách).
type Tab = 'services' | 'materials'
const TAB_OPTIONS: readonly SegmentedOption<Tab>[] = [
  { value: 'services', label: 'Dịch vụ' },
  { value: 'materials', label: 'Nguyên liệu' },
]

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function ServiceCatalogWorkspace() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'materials' ? 'materials' : 'services'
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<ServiceStockFilter>('all')
  const [page, setPage] = useState(0)
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canAdd = hasRight(RIGHT_SERVICE_ADD)
  const canEdit = hasRight(RIGHT_SERVICE_EDIT)
  const canDisable = hasRight(RIGHT_SERVICE_DISABLE)
  const canGroup = hasRight(RIGHT_SERVICE_GROUP)
  // editor: undefined = đóng, null = thêm mới, ServiceItem = sửa món đó.
  const [editor, setEditor] = useState<ServiceItem | null | undefined>(undefined)
  const [groupsOpen, setGroupsOpen] = useState(false)
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
    queryKey: ['services'],
    queryFn: getServices,
  })

  const source = servicesQuery.data ?? []
  const normalizedSearch = search.trim().toLocaleLowerCase('vi')
  const services = source.filter(
    (service) =>
      matchesServiceStock(service, stockFilter) &&
      (!normalizedSearch ||
        service.name.toLocaleLowerCase('vi').includes(normalizedSearch) ||
        service.unit.toLocaleLowerCase('vi').includes(normalizedSearch)),
  )
  const totalPages = Math.max(1, Math.ceil(services.length / PAGE_SIZE))
  const visibleServices = services.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const availableCount = source.filter((service) => matchesServiceStock(service, 'available')).length
  const outCount = source.filter((service) => matchesServiceStock(service, 'out')).length
  const notManagedCount = source.filter((service) => matchesServiceStock(service, 'not-managed')).length

  const toggleStock = (value: ServiceStockFilter) => {
    setStockFilter((current) => (current === value ? 'all' : value))
    setPage(0)
  }

  const hasActiveFilter = stockFilter !== 'all' || search.trim() !== ''
  const clearFilters = () => {
    setStockFilter('all')
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

  if (tab === 'materials') {
    return (
      <section className="service-workspace">
        <PageHeader
          eyebrow="Danh mục"
          title="Dịch vụ & hàng hóa"
          description="Quản lý danh sách nguyên liệu: thêm, sửa, ngừng dùng, nhập/xuất/kiểm kê. Công thức của món được cấu hình ngay trong form dịch vụ."
        />
        {tabs}
        <MaterialsTab />
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
            <Button
              type="button"
              variant="primary"
              disabled={!canAdd}
              title={canAdd ? undefined : 'Cần quyền Thêm dịch vụ (61)'}
              onClick={() => setEditor(null)}
            >
              Thêm dịch vụ
            </Button>
          </>
        }
      />
      {tabs}

      <section className="service-panel__summary" aria-label="Tóm tắt danh mục dịch vụ">
        <button
          type="button"
          className={`service-stat service-stat--total ${stockFilter === 'all' ? 'is-active' : ''}`}
          onClick={() => toggleStock('all')}
        >
          <strong>{new Intl.NumberFormat('vi-VN').format(source.length)}</strong>
          <span className="service-stat__label">dịch vụ</span>
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
      </section>

      <section className="service-filters" aria-label="Lọc dịch vụ">
        <div className="ds-field">
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
      </section>

      <section className="service-panel" aria-label="Danh sách dịch vụ">
        <ListToolbar
          count={<>Tổng <strong>{new Intl.NumberFormat('vi-VN').format(services.length)}</strong></>}
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

        {servicesQuery.isLoading ? (
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
            description={hasActiveFilter ? 'Thử từ khóa hoặc bộ lọc tồn kho khác.' : undefined}
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
            <div className="service-grid">
              {visibleServices.map((service) => {
                const stock = serviceStockLabel(service)
                const system = isReadonlyService(service)
                const stopped = isDiscontinued(service)
                return (
                  <article className={`service-card${stopped ? ' is-off' : ''}`} key={service.id}>
                    <div className="service-card__title">
                      <span>
                        #{service.id}
                        {service.groupName ? ` · ${service.groupName}` : ''}
                      </span>
                      <strong>{service.name}</strong>
                      <small>{service.unit || 'Chưa có đơn vị'}</small>
                      {system || stopped ? (
                        <span className="service-card__badges">
                          {system ? (
                            <StatusBadge tone="info" title="Dòng do hệ thống tự tạo (vd FFOOD), không sửa ở màn này">
                              Dịch vụ hệ thống
                            </StatusBadge>
                          ) : null}
                          {stopped ? <StatusBadge tone="neutral">Ngừng bán</StatusBadge> : null}
                        </span>
                      ) : null}
                    </div>
                    <div className="service-card__price">
                      <span>Giá bán</span>
                      <strong>{formatMoney(service.price)}</strong>
                    </div>
                    <div className="service-card__stock">
                      <StatusBadge tone={stock.tone}>{stock.label}</StatusBadge>
                      {service.inventoryManagement === 1 ? (
                        <strong>
                          {new Intl.NumberFormat('vi-VN').format(service.inventory)}{' '}
                          {service.unit}
                        </strong>
                      ) : (
                        <span>Không áp dụng số lượng</span>
                      )}
                    </div>
                    {system ? null : (
                      <div className="service-card__actions">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!canEdit}
                          title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
                          onClick={() => setEditor(service)}
                        >
                          Sửa
                        </Button>
                        {stopped ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!canEdit}
                            title={canEdit ? undefined : 'Cần quyền Sửa dịch vụ (62)'}
                            loading={activeMutation.isPending && activeMutation.variables?.serviceId === service.id}
                            onClick={() => activeMutation.mutate({ serviceId: service.id, active: true })}
                          >
                            Bán lại
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="danger-outline"
                            disabled={!canDisable}
                            title={canDisable ? undefined : 'Cần quyền Xoá/ngừng bán dịch vụ (63)'}
                            onClick={() => setToggling(service)}
                          >
                            Ngừng bán
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
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
      <ConfirmAction
        open={toggling !== null}
        title={`Ngừng bán [${toggling?.name ?? ''}]?`}
        description="Món bị ẩn khỏi menu bán. Lịch sử bán và công thức giữ nguyên, bật lại bất cứ lúc nào bằng nút “Bán lại”."
        confirmLabel="Ngừng bán"
        danger
        pending={activeMutation.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && activeMutation.mutate({ serviceId: toggling.id, active: false })}
      />
    </section>
  )
}
