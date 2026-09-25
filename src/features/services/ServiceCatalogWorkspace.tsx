import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { getServices } from '../../api/services'
import {
  Button,
  ListPagination,
  ListToolbar,
  PageHeader,
  RefreshButton,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import {
  matchesServiceStock,
  serviceStockLabel,
  type ServiceStockFilter,
} from './serviceModel'
import './services.css'

const PAGE_SIZE = 24

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function ServiceCatalogWorkspace() {
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<ServiceStockFilter>('all')
  const [page, setPage] = useState(0)
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

  return (
    <section className="service-workspace">
      <PageHeader
        eyebrow="Danh mục"
        title="Dịch vụ & hàng hóa"
        description="Danh mục đọc từ máy chủ, gồm giá bán, đơn vị và tồn kho hiện tại."
      />

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
                return (
                  <article className="service-card" key={service.id}>
                    <div className="service-card__title">
                      <span>#{service.id}</span>
                      <strong>{service.name}</strong>
                      <small>{service.unit || 'Chưa có đơn vị'}</small>
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
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </section>
  )
}
