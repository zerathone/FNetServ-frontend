// Kiểu hiển thị 2 của "Chờ duyệt": các thẻ nhỏ nằm ngang trên cùng một hàng với ô tìm kiếm / nút "Cột hiển thị"
// của trang Máy trạm. Mỗi thẻ có nút "⋯" mở đúng menu thao tác của khung bên phải (không có nút ✕ đóng thẻ).
import { useEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight, DotsThreeVertical, SidebarSimple } from '@phosphor-icons/react'
import { formatVnd } from '../orders/orderPayModel'
import { waitTone } from '../orders/orderWaitTime'
import { PendingPayIcon } from './PendingPayIcon'
import { MENU_WIDTH, compactMoney, compactWait } from './pendingServiceModel'
import type { PendingServices } from './usePendingServices'
import './pending-service-panel.css'

export function PendingServiceChips({ pending }: { pending: PendingServices }) {
  const { rows, total, loading, failed, now, selectedKey } = pending
  const active = pending.mode === 'tags'
  const listRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  // Nút nổi cuộn trái/phải: chỉ hiện khi còn thẻ bị che ở phía đó (không có thanh cuộn ngang để kéo).
  const updateEdges = () => {
    const list = listRef.current
    const left = Boolean(list && list.scrollLeft > 1)
    const right = Boolean(list && list.scrollLeft + list.clientWidth < list.scrollWidth - 1)
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }))
  }

  useEffect(() => {
    updateEdges()
    const list = listRef.current
    if (!active || !list) return
    // Đổi cỡ khung hoặc thêm/bớt thẻ ⇒ tính lại.
    const observer = new ResizeObserver(updateEdges)
    observer.observe(list)
    if (list.firstElementChild) observer.observe(list.firstElementChild)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rows.length, loading])

  const scrollBy = (direction: -1 | 1) => {
    const list = listRef.current
    if (list) list.scrollBy({ left: direction * Math.max(160, list.clientWidth * 0.7), behavior: 'smooth' })
  }

  if (!active) return null

  return (
    <div className="ws-tags" aria-label="Chờ duyệt">
      <button
        type="button"
        className="ws-tags__switch"
        title="Chuyển sang khung bên phải danh sách máy"
        aria-label="Chuyển Chờ duyệt sang khung bên phải"
        onClick={() => pending.setMode('panel')}
      >
        <SidebarSimple size={16} weight="bold" aria-hidden="true" />
        <span className="ws-tags__label">Chờ duyệt</span>
        {total ? <span className="ws-pending__count">{total}</span> : null}
      </button>

      <div className="ws-tags__scroller">
      {edges.left ? (
        <button
          type="button"
          className="ws-tags__scroll ws-tags__scroll--left"
          aria-label="Cuộn chờ duyệt sang trái"
          title="Cuộn sang trái"
          onClick={() => scrollBy(-1)}
        >
          <CaretLeft size={14} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {edges.right ? (
        <button
          type="button"
          className="ws-tags__scroll ws-tags__scroll--right"
          aria-label="Cuộn chờ duyệt sang phải"
          title="Cuộn sang phải"
          onClick={() => scrollBy(1)}
        >
          <CaretRight size={14} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      <div
        ref={listRef}
        className="ws-tags__list"
        role="list"
        onScroll={updateEdges}
        // Thanh cuộn ngang ẩn cho gọn hàng: lăn chuột dọc = cuộn ngang dãy thẻ (phòng máy lớn có rất nhiều thẻ).
        onWheel={(event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY
        }}
      >
        {loading ? (
          <span className="ws-tags__empty">Đang tải…</span>
        ) : failed ? (
          <span className="ws-tags__empty">
            Không tải được.{' '}
            <button type="button" className="ws-pending__link" onClick={pending.retry}>
              Thử lại
            </button>
          </span>
        ) : rows.length === 0 ? (
          <span className="ws-tags__empty">Không có dịch vụ nào đang chờ</span>
        ) : (
          rows.map((row) => {
            const customerLine = pending.customerLineOf(row)
            const { host, name, quantity, changed, amount, payKind, detail } = pending.viewOf(row)
            return (
              <div
                key={row.key}
                role="listitem"
                tabIndex={0}
                className={`ws-tag ws-tag--${waitTone(row.createdAtMs, now)}${selectedKey === row.key ? ' is-selected' : ''}`}
                title={`${host} · ${name}${amount ? ` · ${formatVnd(amount)}` : ''} · ${detail} — chuột phải để xem thao tác`}
                onClick={() => pending.setSelectedKey(row.key)}
                onContextMenu={pending.onContextMenu(row)}
                onKeyDown={pending.onRowKeyDown(row)}
              >
                <span className="ws-tag__host">
                  <strong>{host}</strong>
                  {customerLine ? <small>{customerLine}</small> : null}
                </span>
                <span className="ws-tag__main">
                  <span className="ws-tag__name">
                    {name}
                    {quantity && quantity > 1 ? <em className={changed ? 'is-changed' : undefined}> ×{quantity}</em> : null}
                    {changed && quantity === 1 ? <em className="is-changed"> ×1*</em> : null}
                  </span>
                  <span className="ws-tag__meta">
                    <span className="ws-pending__money">
                      <PendingPayIcon kind={payKind} />
                      {amount ? compactMoney(amount) : '—'}
                    </span>
                    <span className={`ws-pending__wait ws-pending__wait--${waitTone(row.createdAtMs, now)}`}>
                      {compactWait(row.createdAtMs, now)}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  className="ws-pending__more"
                  aria-label={`Thao tác cho ${host} · ${name}`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.stopPropagation()
                    const rect = event.currentTarget.getBoundingClientRect()
                    pending.openMenuAt(row, rect.right - MENU_WIDTH, rect.bottom + 2)
                  }}
                >
                  <DotsThreeVertical size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )
          })
        )}
      </div>
      </div>
    </div>
  )
}
