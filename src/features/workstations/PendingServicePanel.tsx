// Kiểu hiển thị 1 của "Chờ duyệt": khung dọc bên phải danh sách máy trạm, mỗi mục là một dòng
// (Tên máy · Yêu cầu · Tiền · SL · Chờ). Hai tab: "Chờ duyệt" (việc đang chờ) và "Đã duyệt" (đơn đã Chấp nhận nhưng
// chưa thu tiền + đơn hoàn thành). Dữ liệu/menu/hộp xác nhận nằm ở `usePendingServices`.
import {
  ArrowLineUp,
  CaretDoubleLeft,
  CaretDoubleRight,
  DotsThreeVertical,
  Receipt,
} from '@phosphor-icons/react'
import { formatVnd } from '../orders/orderPayModel'
import { waitTone } from '../orders/orderWaitTime'
import { PendingPayIcon } from './PendingPayIcon'
import { MENU_WIDTH, compactMoney, compactWait, type PendingRow } from './pendingServiceModel'
import type { PendingServices } from './usePendingServices'
import './pending-service-panel.css'

export function PendingServicePanel({ pending }: { pending: PendingServices }) {
  const { rows, total, now, selectedKey, view, unpaidRows, doneRows } = pending
  // Kiểu "thẻ" thì khung này ẩn hẳn (thẻ nằm ở thanh công cụ).
  if (pending.mode !== 'panel') return null

  // Việc cần thu ngân xử lý: đang chờ duyệt + đã duyệt nhưng chưa thu tiền.
  const actionable = total + unpaidRows.length

  if (pending.collapsed) {
    return (
      <aside className="ws-pending is-collapsed" aria-label="Chờ duyệt">
        <button
          type="button"
          className="ws-pending__rail"
          title="Mở khung Chờ duyệt"
          aria-label={`Mở khung Chờ duyệt${actionable ? `, ${actionable} đơn cần xử lý` : ''}`}
          aria-expanded={false}
          onClick={pending.toggleCollapsed}
        >
          <CaretDoubleLeft size={16} weight="bold" aria-hidden="true" />
          <Receipt size={20} weight={actionable ? 'fill' : 'regular'} aria-hidden="true" />
          {actionable ? <span className="ws-pending__rail-count">{actionable > 99 ? '99+' : actionable}</span> : null}
          <span className="ws-pending__rail-label">Chờ duyệt</span>
        </button>
      </aside>
    )
  }

  const renderRow = (row: PendingRow) => {
    const customerLine = pending.customerLineOf(row)
    const { host, name, quantity, changed, amount, payKind, detail, waitText } = pending.viewOf(row)
    const isDone = row.kind === 'done'
    return (
      <div
        key={row.key}
        role="listitem"
        tabIndex={0}
        className={`ws-pending__row${selectedKey === row.key ? ' is-selected' : ''}${isDone ? ' is-done' : ''}`}
        title={`${detail}${amount ? ` · ${formatVnd(amount)}` : ''} — chuột phải để xem thao tác`}
        onClick={() => pending.setSelectedKey(row.key)}
        onContextMenu={pending.onContextMenu(row)}
        onKeyDown={pending.onRowKeyDown(row)}
      >
        <span className="ws-pending__host">
          <strong>{host}</strong>
          {customerLine ? <small>{customerLine}</small> : null}
        </span>
        <span className="ws-pending__name">{name}</span>
        <span className="ws-pending__money is-num">
          <PendingPayIcon kind={payKind} />
          {amount ? compactMoney(amount) : '—'}
        </span>
        <span
          className={`is-num${changed ? ' is-changed' : ''}`}
          title={changed ? 'Đã đổi số lượng — áp dụng khi Chấp nhận / Thanh toán' : undefined}
        >
          {quantity ?? ''}
          {changed ? '*' : ''}
        </span>
        {/* Đơn hoàn thành: giờ thu, không tô màu cảnh báo chờ lâu. */}
        <span
          className={`is-num ws-pending__wait ws-pending__wait--${isDone ? 'info' : waitTone(row.createdAtMs, now)}`}
          title={isDone ? 'Giờ thu tiền' : undefined}
        >
          {waitText ?? compactWait(row.createdAtMs, now)}
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
  }

  const retryLink = (retry: () => void) => (
    <>
      Không tải được danh sách.{' '}
      <button type="button" className="ws-pending__link" onClick={retry}>
        Thử lại
      </button>
    </>
  )

  const pendingBody = pending.loading ? (
    <p className="ws-pending__empty">Đang tải…</p>
  ) : pending.failed ? (
    <p className="ws-pending__empty">{retryLink(pending.retry)}</p>
  ) : rows.length === 0 ? (
    <p className="ws-pending__empty">Không có dịch vụ nào đang chờ.</p>
  ) : (
    rows.map(renderRow)
  )

  const approvedBody = pending.approvedLoading ? (
    <p className="ws-pending__empty">Đang tải…</p>
  ) : pending.approvedFailed ? (
    <p className="ws-pending__empty">{retryLink(pending.retryApproved)}</p>
  ) : (
    <>
      <div className="ws-pending__section is-unpaid" role="presentation" title="Đã Chấp nhận nhưng khách chưa trả tiền">
        <strong>Chưa thu tiền</strong>
        <span className="ws-pending__section-count">{unpaidRows.length}</span>
      </div>
      {unpaidRows.length === 0 ? (
        <p className="ws-pending__empty is-compact">Không có đơn nào chưa thu tiền.</p>
      ) : (
        unpaidRows.map(renderRow)
      )}
      <div className="ws-pending__section is-done" role="presentation" title="Đơn đã thu tiền xong trong ca hôm nay">
        <strong>Hoàn thành</strong>
        <span className="ws-pending__section-count">{doneRows.length}</span>
        <span className="ws-pending__section-hint">Giờ thu</span>
      </div>
      {doneRows.length === 0 ? (
        <p className="ws-pending__empty is-compact">Chưa có đơn hoàn thành.</p>
      ) : (
        doneRows.map(renderRow)
      )}
    </>
  )

  return (
    <aside className="ws-pending" aria-label="Chờ duyệt">
      <header className="ws-pending__header">
        <div className="ws-pending__tabs" role="tablist" aria-label="Nhóm đơn">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'pending'}
            className={`ws-pending__tab${view === 'pending' ? ' is-active' : ''}`}
            onClick={() => pending.setView('pending')}
          >
            Chờ duyệt
            {total ? <span className="ws-pending__count">{total}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'approved'}
            className={`ws-pending__tab${view === 'approved' ? ' is-active' : ''}`}
            title="Đơn đã Chấp nhận: chưa thu tiền và đã hoàn thành"
            onClick={() => pending.setView('approved')}
          >
            Đã duyệt
            {unpaidRows.length ? (
              <span className="ws-pending__count is-warning" title="Đã duyệt nhưng chưa thu tiền">
                {unpaidRows.length}
              </span>
            ) : null}
            {doneRows.length ? (
              <span className="ws-pending__count is-neutral" title="Đơn hoàn thành (đã thu tiền xong)">
                {doneRows.length}
              </span>
            ) : null}
          </button>
        </div>
        <div className="ws-pending__header-end">
          <button
            type="button"
            className="ws-pending__collapse"
            title="Chuyển sang dạng thẻ trên thanh công cụ"
            aria-label="Chuyển Chờ duyệt sang dạng thẻ trên thanh công cụ"
            onClick={() => pending.setMode('tags')}
          >
            <ArrowLineUp size={16} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ws-pending__collapse"
            title="Thu gọn"
            aria-label="Thu gọn khung Chờ duyệt"
            aria-expanded
            onClick={pending.toggleCollapsed}
          >
            <CaretDoubleRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </header>

      {pending.alerts}

      <div className="ws-pending__cols" aria-hidden="true">
        <span>Tên máy</span>
        <span>Yêu cầu</span>
        <span className="is-num">Tiền</span>
        <span className="is-num">SL</span>
        <span className="is-num">Chờ</span>
        <span />
      </div>

      <div className="ws-pending__list" role="list">
        {view === 'approved' ? approvedBody : pendingBody}
      </div>
    </aside>
  )
}
