import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  acceptComboOrder,
  acceptServiceOrder,
  cancelServiceOrder,
  getPendingComboOrders,
  getPendingOrders,
  getServicePaidLabel,
  rejectComboOrder,
} from '../api/orders'
import type { PendingComboOrder, PendingOrder } from '../api/orders'
import { fingerprintIntent, useIdempotentIntent } from '../lib/idempotency'
import { useAuthStore } from '../store/auth'
import { useOrderQueueStore } from '../store/orderQueue'
import { pushToast } from '../store/toast'
import { useWsStatusStore } from '../store/wsStatus'

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value)
}

function formatTimeAgo(dateStr?: string, timeStr?: string) {
  if (!dateStr || !timeStr) return '-'
  const orderDate = new Date(`${dateStr}T${timeStr}`)
  if (isNaN(orderDate.getTime())) return '-'
  
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - orderDate.getTime()) / 1000)
  
  if (diffInSeconds < 60) return 'Vừa xong'
  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) return `${diffInMinutes} ph trước`
  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) return `${diffInHours} giờ trước`
  const diffInDays = Math.floor(diffInHours / 24)
  return `${diffInDays} ngày trước`
}

// BE trả combo createdAt/expireDate dạng "YYYY-MM-DD HH:MM:SS" (ghép 2 cột DATE + TIME).
// Tách lại thành cặp (date, time) để dùng chung formatTimeAgo với tab dịch vụ.
function splitCreatedAt(createdAt?: string): [string | undefined, string | undefined] {
  if (!createdAt) return [undefined, undefined]
  const parts = createdAt.trim().split(/\s+/)
  return [parts[0], parts[1]]
}

type GroupedOrder = PendingOrder & {
  children: PendingOrder[]
}

export function OrderQueuePage() {
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  const selectedUserId = useOrderQueueStore((state) => state.selectedUserId)
  const hostNameFilter = useOrderQueueStore((state) => state.hostName)
  const setSelectedUserId = useOrderQueueStore((state) => state.setSelectedUserId)
  const setHostName = useOrderQueueStore((state) => state.setHostName)

  const [selectedMainIds, setSelectedMainIds] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'thumbnail' | 'content'>('thumbnail')
  // task 2.24 (P4): 2 tab — "Dịch vụ" (hành vi cũ, không đổi) và "Combo chờ duyệt" (mới).
  const [activeTab, setActiveTab] = useState<'service' | 'combo'>('service')
  const acceptOrderIntent = useIdempotentIntent('accept-order')
  const acceptComboIntent = useIdempotentIntent('accept-combo')
  const rejectComboIntent = useIdempotentIntent('reject-combo')

  const connected = useWsStatusStore((state) => state.connected)

  const ordersQuery = useQuery({
    queryKey: ['pending-orders', selectedUserId],
    queryFn: () => getPendingOrders(selectedUserId),
    refetchInterval: connected ? 30000 : 5000,
  })

  // Chạy cả khi đang ở tab Dịch vụ để badge số lượng luôn đúng (đơn combo tiền mặt là khách
  // đang đứng chờ ở máy — không được để thu ngân phải bấm sang tab mới thấy).
  const comboQuery = useQuery({
    queryKey: ['pending-orders-combo'],
    queryFn: getPendingComboOrders,
    refetchInterval: connected ? 30000 : 5000,
  })
  const comboOrders = comboQuery.data ?? []

  // Gom món chính và topping theo parentId
  const groupedOrders = useMemo<GroupedOrder[]>(() => {
    const orders = ordersQuery.data ?? []
    const mainDetailIds = new Set(
      orders.filter((o: PendingOrder) => !o.parentId || o.parentId === 0).map((o: PendingOrder) => o.serviceDetailId)
    )
    
    const mainOrders = orders.filter((o: PendingOrder) => !o.parentId || o.parentId === 0 || !mainDetailIds.has(o.parentId))
    const toppings = orders.filter((o: PendingOrder) => o.parentId && o.parentId > 0 && mainDetailIds.has(o.parentId))
    
    // Áp dụng filter local theo hostName (nếu Backend chưa filter)
    return mainOrders
      .map((main: PendingOrder) => ({
        ...main,
        children: toppings.filter((t: PendingOrder) => t.parentId === main.serviceDetailId)
      }))
      .filter((main: GroupedOrder) => {
        if (!hostNameFilter) return true
        const host = main.hostName || ''
        return host.toLowerCase().includes(hostNameFilter.toLowerCase())
      })
  }, [ordersQuery.data, hostNameFilter])

  // task 2.24 (P1) — `alreadyPaid: false` cho MỌI dòng là ĐÚNG parity, đã verify 2026-07-29:
  //  • MFC `CServiceWaitingList::AcceptService` (nút Accept) cộng lTotalAmount cho TẤT CẢ dòng đang
  //    chọn, KHÔNG lọc theo iServicePaid, rồi tạo 1 voucher PY_SERVICE_FEE và gán cho mọi dòng —
  //    kể cả dòng mang 4 (tiền mặt tại máy) / 5 (cấn trừ). Xem ServiceWaitingList.cpp:646-679.
  //  • subserv chỉ đặt isPaid=true cho dòng lấy từ selectListServiceNotAccept...(servicePaid=true),
  //    tức ServicePaid = 1. Dòng 0/4/5 luôn isPaid=false (serviceselloperation.cpp:149-180).
  //  • `/orders/pending` CHỈ trả ServicePaid IN (0,4,5) ⇒ từ trang này alreadyPaid luôn phải false.
  // ⚠️ ĐỪNG "sửa" thành `order.servicePaid !== 0`: sẽ đi nhánh acceptPaidRequest, KHÔNG tạo voucher
  // running-tab và làm đơn 4/5 mất tiền phải thu (lệch hẳn so với đường MFC).
  const getMutationItemsForMain = (mainOrder: GroupedOrder) => {
    return [
      { detailId: mainOrder.serviceDetailId, quantity: mainOrder.quantity, amount: mainOrder.amount, alreadyPaid: false },
      ...mainOrder.children.map((t: PendingOrder) => ({ detailId: t.serviceDetailId, quantity: t.quantity, amount: t.amount, alreadyPaid: false }))
    ]
  }

  const acceptMutation = useMutation({
    mutationFn: (mainOrder: GroupedOrder) => {
      const items = getMutationItemsForMain(mainOrder)
      return acceptServiceOrder({
        staffId: String(staffId ?? ''),
        userId: mainOrder.userId,
        anonymous: mainOrder.userId === 0,
        hostName: mainOrder.hostName || '',
        idem: acceptOrderIntent.getKey(
          fingerprintIntent({
            serviceDetailId: mainOrder.serviceDetailId,
            userId: mainOrder.userId,
            hostName: mainOrder.hostName || '',
            items,
          }),
        ),
        items,
      });
    },
    onSuccess: () => {
      acceptOrderIntent.clearKey()
      pushToast('Chấp nhận đơn thành công!', 'success')
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    },
    onError: (error: Error) => {
      pushToast(`Lỗi chấp nhận: ${error.message}`, 'error')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (mainOrder: GroupedOrder) => {
      const items = [
        { type: 'service' as const, id: mainOrder.serviceDetailId },
        ...mainOrder.children.map((t: PendingOrder) => ({ type: 'service' as const, id: t.serviceDetailId }))
      ];
      return cancelServiceOrder({
        staffId: String(staffId ?? ''),
        items
      })
    },
    onSuccess: () => {
      pushToast('Đã hủy đơn thành công!', 'success')
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    },
    onError: (error: Error) => {
      pushToast(`Lỗi hủy đơn: ${error.message}`, 'error')
    },
  })

  const bulkCancelMutation = useMutation({
    mutationFn: async (mainIds: number[]) => {
      const ordersToCancel = groupedOrders.filter((o: GroupedOrder) => mainIds.includes(o.serviceDetailId))
      const items = ordersToCancel.flatMap((main: GroupedOrder) => [
        { type: 'service' as const, id: main.serviceDetailId },
        ...main.children.map((t: PendingOrder) => ({ type: 'service' as const, id: t.serviceDetailId }))
      ])
      
      return cancelServiceOrder({
        staffId: String(staffId ?? ''),
        items
      })
    },
    onSuccess: () => {
      pushToast('Hủy hàng loạt thành công!', 'success')
      setSelectedMainIds(new Set())
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    },
    onError: (error: Error) => {
      pushToast(`Lỗi hủy hàng loạt: ${error.message}`, 'error')
    },
  })

  // ===== task 2.24 (P3/P4): tab combo — xác nhận đã thu tiền / từ chối =====
  const comboAcceptMutation = useMutation({
    mutationFn: (order: PendingComboOrder) =>
      acceptComboOrder({
        comboCardId: order.comboCardId,
        idem: acceptComboIntent.getKey(
          fingerprintIntent({
            comboCardId: order.comboCardId,
            hostName: order.hostName ?? '',
            price: order.price,
          }),
        ),
        hostName: order.hostName ?? '',
      }),
    onSuccess: (data) => {
      acceptComboIntent.clearKey()
      pushToast(
        data?.duplicated ? 'Đơn combo đã được xác nhận trước đó.' : 'Đã xác nhận thu tiền combo!',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
    },
    onError: (error: Error) => {
      pushToast(`Lỗi xác nhận combo: ${error.message}`, 'error')
    },
  })

  const comboRejectMutation = useMutation({
    mutationFn: (order: PendingComboOrder) =>
      rejectComboOrder({
        comboCardId: order.comboCardId,
        idem: rejectComboIntent.getKey(
          fingerprintIntent({ comboCardId: order.comboCardId }),
        ),
      }),
    onSuccess: () => {
      rejectComboIntent.clearKey()
      pushToast('Đã từ chối đơn combo.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
    },
    onError: (error: Error) => {
      pushToast(`Lỗi từ chối combo: ${error.message}`, 'error')
    },
  })

  const comboBusy = comboAcceptMutation.isPending || comboRejectMutation.isPending

  const confirmComboAccept = (order: PendingComboOrder) => {
    const ok = window.confirm(
      `Xác nhận ĐÃ THU ${formatMoney(order.price)}đ tiền mặt cho combo "${order.comboName}"?\n` +
        `Máy: ${order.hostName ?? '(không xác định)'} — Khách: ${order.ownerName || order.ownerId}\n` +
        `Thẻ combo: ${order.comboUserName}`,
    )
    if (ok) comboAcceptMutation.mutate(order)
  }

  const confirmComboReject = (order: PendingComboOrder) => {
    const ok = window.confirm(
      `TỪ CHỐI đơn combo "${order.comboName}" (${formatMoney(order.price)}đ)?\n` +
        `Đơn sẽ bị hủy, không sinh phiếu thu và khách KHÔNG nhận được combo.`,
    )
    if (ok) comboRejectMutation.mutate(order)
  }

  const comboTotalAmount = useMemo(
    () => (comboQuery.data ?? []).reduce((sum: number, o: PendingComboOrder) => sum + o.price, 0),
    [comboQuery.data],
  )

  const summary = useMemo(() => {
    return groupedOrders.reduce(
      (acc: { count: number, amount: number }, order: GroupedOrder) => {
        acc.count += 1
        const totalAmount = order.amount + order.children.reduce((sum: number, child: PendingOrder) => sum + child.amount, 0)
        acc.amount += totalAmount
        return acc
      },
      { count: 0, amount: 0 },
    )
  }, [groupedOrders])

  const allMainIds = groupedOrders.map((o: GroupedOrder) => o.serviceDetailId)
  const allSelected = allMainIds.length > 0 && selectedMainIds.size === allMainIds.length

  const handleSelectAll = () => {
    if (allSelected) setSelectedMainIds(new Set())
    else setSelectedMainIds(new Set(allMainIds))
  }

  const toggleSelection = (id: number) => {
    const newSet = new Set(selectedMainIds)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedMainIds(newSet)
  }

  return (
    <section className="page-card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Dịch vụ chờ xử lý</p>
          <h2 className="section-title">Order Queue</h2>
        </div>
      </div>

      {/* task 2.24 (P4): tab bar + badge số lượng */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        {([
          { key: 'service' as const, label: 'Dịch vụ', count: summary.count },
          { key: 'combo' as const, label: 'Combo chờ duyệt', count: comboOrders.length },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 1.1rem',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {tab.label}
            <span
              style={{
                minWidth: '1.4rem',
                padding: '1px 6px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                background: tab.count > 0 ? 'var(--primary)' : 'var(--border)',
                color: tab.count > 0 ? '#fff' : 'var(--text-muted)',
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === 'combo' ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Combo chờ duyệt</span>
              <strong className="stat-value">{comboOrders.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Tổng tiền chờ thu</span>
              <strong className="stat-value">{formatMoney(comboTotalAmount)}đ</strong>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '0.5rem', marginTop: '1.5rem' }}>
            {comboQuery.isLoading ? <p className="status-text">Đang tải dữ liệu...</p> : null}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {comboOrders.map((order: PendingComboOrder) => (
                <div
                  key={order.comboCardId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    padding: '1.25rem',
                    background: 'var(--bg-card)',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ width: '200px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      💻 {order.hostName ?? 'Máy ??'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Khách: {order.ownerName || `ID ${order.ownerId}`}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      ⏱ {formatTimeAgo(...splitCreatedAt(order.createdAt))}
                    </div>
                  </div>

                  <div style={{ flex: 1, padding: '0 1rem', borderLeft: '1px solid var(--border)' }}>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>🎟 {order.comboName}</strong>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Thẻ combo: {order.comboUserName || '-'}
                      {order.zone ? ` • Khu vực: ${order.zone}` : ''}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Hết hạn: {order.expireDate}
                    </div>
                  </div>

                  <div style={{ width: '160px', textAlign: 'right', borderLeft: '1px solid var(--border)', paddingLeft: '1rem', flexShrink: 0 }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '4px' }}>Số tiền</div>
                    <strong style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>{formatMoney(order.price)}đ</strong>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '190px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ padding: '6px', fontSize: '0.9rem' }}
                      disabled={comboBusy}
                      onClick={() => confirmComboAccept(order)}
                    >
                      ✔ Xác nhận đã thu tiền
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '6px', fontSize: '0.9rem', color: 'var(--text-error)', borderColor: 'var(--border)' }}
                      disabled={comboBusy}
                      onClick={() => confirmComboReject(order)}
                    >
                      ✖ Từ chối
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {!comboQuery.isLoading && comboOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: '12px' }}>
                Không có đơn combo nào đang chờ duyệt.
              </div>
            ) : null}
          </div>
        </>
      ) : (
      <>
      <div className="toolbar-grid">
        <label className="field compact-field">
          <span>Filter userId</span>
          <input
            placeholder="Để trống = tất cả"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
          />
        </label>
        <label className="field compact-field">
          <span>Host name</span>
          <input 
            placeholder="Tên máy..."
            value={hostNameFilter} 
            onChange={(event) => setHostName(event.target.value)} 
          />
        </label>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Tổng đơn chờ</span>
          <strong className="stat-value">{summary.count}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Tổng tiền</span>
          <strong className="stat-value">{formatMoney(summary.amount)}đ</strong>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <span style={{ fontSize: '1.25rem' }}>{allSelected ? '☑' : '☐'}</span>
            <span style={{ fontWeight: 500 }}>Chọn tất cả</span>
            <input 
              type="checkbox" 
              checked={allSelected} 
              onChange={handleSelectAll} 
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={selectedMainIds.size === 0 || bulkCancelMutation.isPending}
            onClick={() => bulkCancelMutation.mutate(Array.from(selectedMainIds))}
            style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', color: 'var(--text-error)', borderColor: 'var(--text-error)' }}
          >
            {bulkCancelMutation.isPending ? 'Đang hủy...' : `Hủy hàng loạt (${selectedMainIds.size})`}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-input)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => setViewMode('thumbnail')}
            style={{ 
              padding: '6px 12px', 
              borderRadius: '6px', 
              border: 'none', 
              background: viewMode === 'thumbnail' ? 'var(--bg-hover)' : 'transparent',
              color: viewMode === 'thumbnail' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: viewMode === 'thumbnail' ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            Card (Thunbnail)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('content')}
            style={{ 
              padding: '6px 12px', 
              borderRadius: '6px', 
              border: 'none', 
              background: viewMode === 'content' ? 'var(--bg-hover)' : 'transparent',
              color: viewMode === 'content' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: viewMode === 'content' ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            List (Content)
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '0.5rem', marginTop: '1.5rem' }}>
      {ordersQuery.isLoading ? <p className="status-text">Đang tải dữ liệu...</p> : null}
      
      {/* ----------------- VIEW 1: CARD (THUMBNAIL) ----------------- */}
      {viewMode === 'thumbnail' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '1.5rem',
        }}>
          {groupedOrders.map((order: GroupedOrder) => {
            const isSelected = selectedMainIds.has(order.serviceDetailId)
            const totalAmount = order.amount + order.children.reduce((s: number, c: PendingOrder) => s + c.amount, 0)
            const timeAgo = formatTimeAgo(order.serviceDate, order.serviceTime)
            
            return (
              <article 
                key={order.serviceDetailId} 
                style={{ 
                  background: 'var(--bg-card)',
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                  boxShadow: isSelected ? '0 0 0 1px var(--primary)' : '0 2px 8px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}
              >
                {/* Header */}
                <div style={{
                  padding: '1rem',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--bg-hover)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div onClick={() => toggleSelection(order.serviceDetailId)} style={{ cursor: 'pointer', display: 'flex', fontSize: '1.25rem', userSelect: 'none' }}>
                      {isSelected ? '☑' : '☐'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        💻 {order.hostName || `Máy ??`}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{order.userName || 'Khách vãng lai'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      ⏱ {timeAgo}
                    </div>
                    <span style={{ fontSize: '0.75rem', padding: '2px 6px', background: 'var(--border)', borderRadius: '4px', color: 'var(--text-primary)' }}>
                      {getServicePaidLabel(order.servicePaid)}
                    </span>
                  </div>
                </div>

                {/* Body (Items) */}
                <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Món chính */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.05rem' }}>
                        {order.serviceName}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        SL: {order.quantity} x {formatMoney(order.price)}đ
                      </div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{formatMoney(order.amount)}đ</div>
                  </div>

                  {/* Toppings */}
                  {order.children.length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      paddingLeft: '1rem',
                      borderLeft: '2px dashed var(--border)'
                    }}>
                      {order.children.map((topping: PendingOrder) => (
                        <div key={topping.serviceDetailId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                          <div style={{ color: 'var(--text-secondary)' }}>
                            + {topping.serviceName} <span style={{ fontSize: '0.8rem' }}>(x{topping.quantity})</span>
                          </div>
                          <div style={{ color: 'var(--text-primary)' }}>{formatMoney(topping.amount)}đ</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer (Total & Actions) */}
                <div style={{
                  padding: '1rem',
                  borderTop: '1px dashed var(--border)',
                  background: 'var(--bg-input)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Tổng cộng:</span>
                    <strong style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>{formatMoney(totalAmount)}đ</strong>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ flex: 1, padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                      disabled={acceptMutation.isPending || cancelMutation.isPending}
                      onClick={() => acceptMutation.mutate(order)}
                    >
                      <span style={{ marginRight: '4px' }}>✔</span> Chấp nhận
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '0.5rem', color: 'var(--text-error)', borderColor: 'var(--border)' }}
                      disabled={acceptMutation.isPending || cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(order)}
                      title="Hủy đơn"
                    >
                      ✖
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* ----------------- VIEW 2: CONTENT (MODERN LIST) ----------------- */}
      {viewMode === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {groupedOrders.map((order: GroupedOrder) => {
            const isSelected = selectedMainIds.has(order.serviceDetailId)
            const totalAmount = order.amount + order.children.reduce((s: number, c: PendingOrder) => s + c.amount, 0)
            const timeAgo = formatTimeAgo(order.serviceDate, order.serviceTime)
            
            return (
              <div 
                key={order.serviceDetailId} 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.5rem',
                  padding: '1.25rem',
                  background: 'var(--bg-card)',
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                  boxShadow: isSelected ? '0 0 0 1px var(--primary)' : '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                {/* Select Box */}
                <div onClick={() => toggleSelection(order.serviceDetailId)} style={{ cursor: 'pointer', fontSize: '1.5rem', userSelect: 'none' }}>
                  {isSelected ? '☑' : '☐'}
                </div>
                
                {/* Machine & User */}
                <div style={{ width: '180px', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    💻 {order.hostName || `Máy ??`}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Khách hàng: {order.userName || 'Khách vãng lai'}</div>
                  <div style={{ marginTop: '6px' }}>
                    <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--bg-hover)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                      {getServicePaidLabel(order.servicePaid)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div style={{ flex: 1, padding: '0 1rem', borderLeft: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: order.children.length ? '6px' : '0' }}>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>{order.serviceName}</strong>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                      x{order.quantity} <span style={{ margin: '0 8px' }}>•</span> {formatMoney(order.amount)}đ
                    </div>
                  </div>
                  
                  {order.children.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px', borderLeft: '2px solid var(--border)' }}>
                      {order.children.map((topping: PendingOrder) => (
                        <div key={topping.serviceDetailId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>+ {topping.serviceName}</span>
                          <span style={{ color: 'var(--text-muted)' }}>x{topping.quantity} ({formatMoney(topping.amount)}đ)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Total & Time */}
                <div style={{ width: '160px', textAlign: 'right', borderLeft: '1px solid var(--border)', paddingLeft: '1rem', flexShrink: 0 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '4px' }}>Tổng cộng</div>
                  <strong style={{ fontSize: '1.4rem', color: 'var(--text-primary)', display: 'block', marginBottom: '8px' }}>
                    {formatMoney(totalAmount)}đ
                  </strong>
                  <div style={{ fontSize: '0.85rem', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px' }}>
                    ⏱ {timeAgo}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '120px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="primary-button"
                    style={{ padding: '6px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    disabled={acceptMutation.isPending || cancelMutation.isPending}
                    onClick={() => acceptMutation.mutate(order)}
                  >
                    <span style={{ marginRight: '4px' }}>✔</span> Duyệt
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ padding: '6px', fontSize: '0.9rem', color: 'var(--text-error)', borderColor: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                    disabled={acceptMutation.isPending || cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate(order)}
                  >
                    ✖ Hủy
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!ordersQuery.isLoading && groupedOrders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: '12px' }}>
          Không có đơn hàng nào đang chờ xử lý.
        </div>
      ) : null}
      </div>
      </>
      )}
    </section>
  )
}
