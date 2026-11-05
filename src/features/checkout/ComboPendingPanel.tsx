import { useEffect, useState } from 'react'
import { XCircle } from '@phosphor-icons/react'
import { Button, ListPagination, StateView, StatusBadge } from '../../design-system/components'
import { waitLabel, waitTone } from '../orders/orderWaitTime'
import { useComboPendingActions } from './useComboPendingActions'
import {
  formatExpireDate,
  formatZoneList,
  parseComboCreatedAt,
  usePendingComboOrders,
} from './comboPendingModel'
// Dùng lại giao diện thẻ đơn của /orders (class global `order-card*`, `order-panel*`, `order-confirm-*`).
import '../orders/orders.css'

const PAGE_SIZE = 20

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

/**
 * "Combo chờ duyệt" -- chuyển từ trang /orders sang /combo_sale (user chốt 2026-10-10). Thu ngân xác nhận
 * đã nhận tiền mặt (MONEY-CORE `/orders/combo/accept`, idem bắt buộc) hoặc từ chối (`/orders/combo/reject`).
 * Logic mutation + idem GIỮ NGUYÊN từ OrderWorkspace.
 */
export function ComboPendingPanel() {
  const { query, orders } = usePendingComboOrders()
  const [page, setPage] = useState(0)
  const comboActions = useComboPendingActions()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE))
  const visibleOrders = orders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1)
  }, [page, totalPages])

  return (
    <section className="order-panel" aria-label="Combo chờ xác nhận">
      <h3 className="order-panel__heading">Combo chờ xác nhận</h3>
      {query.isLoading ? (
        <StateView title="Đang tải đơn combo" />
      ) : query.isError ? (
        <StateView
          title="Không tải được đơn combo"
          description={(query.error as Error).message}
          action={<Button onClick={() => query.refetch()}>Thử lại</Button>}
        />
      ) : orders.length === 0 ? (
        // Rỗng là trạng thái phổ biến (hết việc) -- 1 dòng ngắn, không dùng StateView (cao 10rem).
        <p className="order-empty-compact">Không có combo chờ xác nhận.</p>
      ) : (
        <>
          <ListPagination
            page={page}
            totalPages={totalPages}
            canNext={page < totalPages - 1}
            onPrevious={() => setPage((value) => Math.max(0, value - 1))}
            onNext={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
          />
          <div className="order-list-region">
            <div className="order-list">
              {visibleOrders.map((order) => {
                const createdAt = parseComboCreatedAt(order.createdAt)
                return (
                  <article key={order.comboCardId} className="order-card order-card--combo">
                    <div className="order-card__identity">
                      <strong>{order.hostName || 'Chưa xác định máy'}</strong>
                      <span className="order-card__username">{order.ownerName || 'Khách vãng lai'}</span>
                      <div className="order-card__meta-row">
                        <StatusBadge tone={waitTone(createdAt, now)}>
                          Chờ {waitLabel(createdAt, now)}
                        </StatusBadge>
                      </div>
                    </div>
                    <div
                      className="order-card__items"
                      style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start' }}
                    >
                      <div style={{ display: 'grid', minWidth: 0, overflow: 'hidden' }}>
                        <strong>{order.comboName}</strong>
                        {order.zone ? (
                          <small>
                            Khu vực: <span className="order-card__zone-value">{formatZoneList(order.zone)}</span>
                          </small>
                        ) : null}
                      </div>
                      <div style={{ display: 'grid', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span>Hết hạn</span>
                        <span className="order-card__expire-value">{formatExpireDate(order.expireDate)}</span>
                      </div>
                    </div>
                    <div className="order-card__total">
                      <span>Tiền mặt cần thu</span>
                      <strong>{formatMoney(order.price)}</strong>
                    </div>
                    <div className="order-card__actions">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={comboActions.pendingMutation}
                        onClick={() => comboActions.askAccept(order)}
                      >
                        Đã thu tiền
                      </Button>
                      <Button
                        type="button"
                        variant="danger-outline"
                        icon={<XCircle size={18} weight="bold" aria-hidden="true" />}
                        disabled={comboActions.pendingMutation}
                        onClick={() => comboActions.askReject(order)}
                      >
                        Từ chối
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </>
      )}

      {comboActions.dialog}
    </section>
  )
}
