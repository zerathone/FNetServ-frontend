import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ticket } from '@phosphor-icons/react'
import { getWorkstationOrders, type WorkstationOrderStatus } from '../../api/workstations'
import { Button, InlineAlert, StatusBadge, type StatusTone } from '../../design-system/components'
import {
  MACHINE_ORDER_STATUS_LABEL,
  groupMachineOrders,
  machineOrdersSummary,
  machineOrdersWaitingTotal,
  splitMachineOrders,
  type MachineOrderLine,
  type MachineOrdersSummary,
} from './machineOrdersModel'
import { CallBellIcon } from './CallBellIcon'
import { formatMoney } from './workstationModel'

// Đơn hàng khách đã gọi/mua trong PHIÊN CHƠI hiện tại của một máy (nhóm "Đơn hàng" ở drawer chi tiết
// máy): món dịch vụ + combo. Một lần gọi GET /workstations/orders — Server tự lọc theo máy + phiên và tính
// sẵn số đếm.

const STATUS_TONE: Record<WorkstationOrderStatus, StatusTone> = {
  waiting: 'warning',
  accepted: 'info',
  paid: 'success',
}

const NO_LINES: MachineOrderLine[] = []
const EMPTY_SUMMARY: MachineOrdersSummary = {
  orderedCount: 0,
  waitingCount: 0,
  comboCount: 0,
  comboWaitingCount: 0,
}

export type MachineOrdersView = {
  lines: MachineOrderLine[]
  summary: MachineOrdersSummary
}

const EMPTY_VIEW: MachineOrdersView = { lines: NO_LINES, summary: EMPTY_SUMMARY }

export function useMachineOrders(hostName: string | null, enabled: boolean, connected: boolean) {
  const query = useQuery({
    queryKey: ['workstation-orders', hostName],
    queryFn: () => getWorkstationOrders(hostName as string),
    enabled: enabled && Boolean(hostName),
    refetchInterval: connected ? 15_000 : 8_000,
  })

  const view = useMemo<MachineOrdersView>(() => {
    if (!query.data) return EMPTY_VIEW
    return {
      lines: groupMachineOrders(query.data.items, query.data.combos ?? []),
      // Server cũ chưa trả combo -> mặc định 0, không làm vỡ số đếm.
      summary: { ...EMPTY_SUMMARY, ...query.data.summary },
    }
  }, [query.data])

  return {
    view,
    // Chỉ "đang tải" khi CHƯA có dữ liệu để hiện (lần đầu); refetch nền không nhấp nháy.
    isLoading: query.isLoading,
    error: query.isError ? (query.error as Error) : null,
  }
}

/**
 * Dòng tóm tắt compact: mỗi cụm = chấm màu + SỐ rõ (đậm, màu chữ chính) + nhãn mờ — cùng kiểu thẻ thống
 * kê "Sử dụng" ở đầu trang. Chỉ hiện cụm có số; "đang chờ" gộp món chờ + combo chờ.
 */
export function MachineOrdersCounts({ summary }: { summary: MachineOrdersSummary }) {
  const waiting = machineOrdersWaitingTotal(summary)
  const chips: Array<{ key: string; tone: string; count: number; label: string }> = [
    { key: 'service', tone: 'service', count: summary.orderedCount, label: 'món' },
    { key: 'combo', tone: 'combo', count: summary.comboCount, label: 'combo' },
    { key: 'waiting', tone: 'waiting', count: waiting, label: 'đang chờ' },
  ].filter((chip) => chip.count > 0)

  if (chips.length === 0) return <>Chưa gọi món</>
  return (
    <span className="ws-counts" aria-label={machineOrdersSummary(summary)}>
      {chips.map((chip) => (
        <span key={chip.key} className={`ws-count ws-count--${chip.tone}`} aria-hidden="true">
          <span className={`ws-count__dot ws-count__dot--${chip.tone}`} />
          <strong className="ws-count__num">{chip.count}</strong>
          <span className="ws-count__label">{chip.label}</span>
        </span>
      ))}
    </span>
  )
}

function timeLabel(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function OrderLine({ line }: { line: MachineOrderLine }) {
  return (
    <li className="ws-order-item">
      <div className="ws-order-item__main">
        <span className="ws-order-item__name">
          {line.kind === 'combo' ? <Ticket size={16} weight="bold" aria-label="Combo" className="ws-order-item__kind" /> : null}
          {line.name}
          {line.kind === 'service' ? <span className="ws-order-item__qty"> × {line.quantity}</span> : null}
        </span>
        {line.toppings.map((topping) => (
          <span key={topping.id} className="ws-order-item__topping">
            + {topping.name} × {topping.quantity}
          </span>
        ))}
        {/* Combo chỉ hiện tên — không kèm giờ mua / hạn dùng (user chốt). */}
        {line.kind === 'service' && line.createdAtMs ? (
          <span className="ws-order-item__time">Gọi lúc {timeLabel(line.createdAtMs)}</span>
        ) : null}
      </div>
      <div className="ws-order-item__side">
        <StatusBadge tone={STATUS_TONE[line.status]}>{MACHINE_ORDER_STATUS_LABEL[line.status]}</StatusBadge>
        <span className="ws-order-item__amount">{formatMoney(line.amount)}</span>
      </div>
    </li>
  )
}

function OrderSection({ title, lines }: { title: string; lines: MachineOrderLine[] }) {
  if (lines.length === 0) return null
  return (
    <section className="ws-order-section">
      <h4 className="ws-tech-block__title">{title}</h4>
      <ul className="ws-order-list">
        {lines.map((line) => (
          <OrderLine key={`${line.kind}-${line.id}`} line={line} />
        ))}
      </ul>
    </section>
  )
}

type MachineOrderListProps = {
  view: MachineOrdersView
  error: Error | null
  /** Sang trang Hàng đợi gọi món (duyệt dịch vụ), lọc sẵn theo máy. */
  onReviewServices: () => void
  /** Sang trang Combo, mở sẵn danh sách combo chờ duyệt. */
  onReviewCombos: () => void
}

export function MachineOrderList({ view, error, onReviewServices, onReviewCombos }: MachineOrderListProps) {
  const { waiting, done } = splitMachineOrders(view.lines)
  const waitingServices = view.summary.waitingCount
  const waitingCombos = view.summary.comboWaitingCount

  return (
    <>
      {/* Chỉ ĐIỀU HƯỚNG sang trang duyệt — duyệt/thu tiền là money-core, không làm trong drawer. Đứng
          TRÊN danh sách: việc cần làm thấy trước, không phải cuộn qua lịch sử mới tới nút. */}
      <div className="ws-action-grid ws-action-grid--top">
        <Button type="button" variant="secondary" icon={<CallBellIcon size={18} />} onClick={onReviewServices}>
          Duyệt dịch vụ{waitingServices > 0 ? ` (${waitingServices})` : ''}
        </Button>
        <Button type="button" variant="secondary" icon={<Ticket size={18} weight="bold" aria-hidden="true" />} onClick={onReviewCombos}>
          Duyệt combo{waitingCombos > 0 ? ` (${waitingCombos})` : ''}
        </Button>
      </div>
      {error ? (
        <InlineAlert tone="warning">Không tải được danh sách đơn: {error.message}</InlineAlert>
      ) : null}
      {view.lines.length === 0 ? (
        <p className="ws-muted">Chưa gọi món.</p>
      ) : (
        <>
          {/* Cần thu ngân xử lý nên đứng trên; phần còn lại là lịch sử trong phiên. */}
          <OrderSection title="Chờ duyệt" lines={waiting} />
          <OrderSection title="Đã gọi / đã mua" lines={done} />
        </>
      )}
    </>
  )
}
