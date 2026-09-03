import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getServices } from '../../api/services'
import { Select,
  Button,
  InlineAlert,
  ListPagination,
  PageHeader,
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
  const managedCount = source.filter(
    (service) => service.inventoryManagement === 1,
  ).length
  const outCount = source.filter(
    (service) =>
      service.inventoryManagement === 1 && service.inventory <= 0,
  ).length

  return (
    <section className="service-workspace">
      <PageHeader
        eyebrow="Danh mục"
        title="Dịch vụ & hàng hóa"
        description="Danh mục đọc từ máy chủ, gồm giá bán, đơn vị và tồn kho hiện tại."
        actions={
          <Button
            type="button"
            variant="secondary"
            loading={servicesQuery.isFetching}
            onClick={() => void servicesQuery.refetch()}
          >
            Làm mới
          </Button>
        }
      />

      <InlineAlert tone="info">
        Màn này đang ở chế độ chỉ đọc. Thêm, sửa, xóa, nhập hàng, công thức/topping
        và định tuyến máy in chờ contract F&amp;B/kho; WebUI không ghi trực tiếp vào
        đường MFC cũ đã ngừng sử dụng.
      </InlineAlert>

      <section className="service-summary" aria-label="Tóm tắt danh mục dịch vụ">
        <div>
          <span>Tổng danh mục</span>
          <strong>{source.length}</strong>
        </div>
        <div>
          <span>Có quản lý tồn</span>
          <strong>{managedCount}</strong>
        </div>
        <div className={outCount > 0 ? 'is-danger' : ''}>
          <span>Đang hết tồn</span>
          <strong>{outCount}</strong>
        </div>
      </section>

      <section className="service-filters" aria-label="Lọc dịch vụ">
        <label className="ds-field">
          <span className="ds-field__label">Tìm tên hoặc đơn vị</span>
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Ví dụ: mì, chai, phần…"
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Tồn kho</span>
          <Select
            className="ds-select"
            value={stockFilter}
            onChange={(event) => {
              setStockFilter(event.target.value as ServiceStockFilter)
              setPage(0)
            }}
          >
            <option value="all">Tất cả</option>
            <option value="available">Còn tồn</option>
            <option value="out">Hết tồn</option>
            <option value="not-managed">Không quản lý tồn</option>
          </Select>
        </label>
      </section>

      <section className="service-panel" aria-label="Danh sách dịch vụ">
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
            title="Không có dịch vụ phù hợp"
            description="Thử từ khóa hoặc bộ lọc tồn kho khác."
          />
        ) : (
          <>
            <ListPagination
              page={page}
              totalPages={totalPages}
              canNext={page < totalPages - 1}
              onPrevious={() => setPage((value) => Math.max(0, value - 1))}
              onNext={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            />
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
          </>
        )}
      </section>
    </section>
  )
}
