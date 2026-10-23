import { CalendarPlus, CallBell, Ticket, Wallet } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { usePendingComboOrders } from '../features/checkout/comboPendingModel'
import { useHealthAlertSummary } from '../features/health-monitor/useHealthAlertSummary'
import { useBookingNavCounts } from '../features/online-booking/useBookingNavCounts'
import { useOrderNavCounts } from '../features/orders/useOrderNavCounts'
import {
  formatSelfPaymentAmount,
  SELF_PAYMENT_LABEL,
  type SelfPaymentKind,
} from '../features/transactions/selfPaymentModel'
import { useSelfPaymentFlash } from '../features/transactions/useSelfPaymentFlash'
import { useWorkstationNavCounts } from '../features/workstations/useWorkstationNavCounts'
import { useNavBadge, type NavBadgeState } from './useNavBadge'

// Các số / badge cạnh nhãn mục menu trái. Mỗi mục có 1 component riêng, mount cùng mục menu nên chỉ tải dữ liệu
// khi mục đó đang hiện (workspace hiện tại). Component trả null khi không có gì để hiện.
//
// Quy tắc chung của các chấm số (máy trạm / đơn dịch vụ / đặt máy / combo):
//   - chỉ hiện khi số > 0;
//   - số tăng / giảm / về 0 thì chớp (sáng -> mờ -> sáng) 10 giây (useNavBadge); về 0 thì chấm nán lại số 0
//     và chớp 3 giây rồi mới biến mất.

export type NavBadgeTone = 'playing' | 'available' | 'disconnected' | 'pending' | 'accepted' | 'confirmed'

function NavCountChip({
  badge,
  tone,
  title,
  label,
}: {
  badge: NavBadgeState
  tone: NavBadgeTone
  title: string
  label: string
}) {
  if (!badge.visible) return null
  const classes = ['workspace-nav__count', `workspace-nav__count--${tone}`]
  if (badge.pulsing) classes.push('is-pulsing')
  if (badge.value === 0) classes.push('is-zero')
  return (
    <span className={classes.join(' ')} title={title} aria-label={`${label}: ${badge.value}`}>
      <span className="workspace-nav__count-dot" aria-hidden="true" />
      {badge.value}
    </span>
  )
}

function CountsGroup({ children, show }: { children: ReactNode; show: boolean }) {
  return show ? <span className="workspace-nav__counts">{children}</span> : null
}

function WorkstationBadges({ pollNavData }: { pollNavData: boolean }) {
  const counts = useWorkstationNavCounts(true, pollNavData)
  const playing = useNavBadge(counts?.playing)
  const available = useNavBadge(counts?.available)
  const disconnected = useNavBadge(counts?.disconnected)
  return (
    <CountsGroup show={playing.visible || available.visible || disconnected.visible}>
      <NavCountChip badge={playing} tone="playing" title="Sử dụng" label="Sử dụng" />
      <NavCountChip badge={available} tone="available" title="Sẵn sàng" label="Sẵn sàng" />
      <NavCountChip badge={disconnected} tone="disconnected" title="Mất kết nối" label="Mất kết nối" />
    </CountsGroup>
  )
}

// Màu khớp tile ở trang Đơn dịch vụ: chưa duyệt = warning, đã chấp nhận = info.
function OrderBadges() {
  const counts = useOrderNavCounts(true)
  const pending = useNavBadge(counts?.pending)
  const accepted = useNavBadge(counts?.acceptedUnpaid)
  return (
    <CountsGroup show={pending.visible || accepted.visible}>
      <NavCountChip badge={pending} tone="pending" title="Đơn chờ chưa duyệt" label="Đơn chờ chưa duyệt" />
      <NavCountChip badge={accepted} tone="accepted" title="Đơn đã chấp nhận, chưa thu tiền" label="Đơn đã chấp nhận" />
    </CountsGroup>
  )
}

// Combo khách mua từ máy trạm đang chờ thu ngân xác nhận -- cùng hook/cache với nút "Chờ xác nhận" ở /combo_sale.
function ComboBadges() {
  const { query, orders } = usePendingComboOrders(true)
  const pending = useNavBadge(query.data ? orders.length : null)
  return (
    <CountsGroup show={pending.visible}>
      <NavCountChip badge={pending} tone="pending" title="Combo chờ xác nhận" label="Combo chờ xác nhận" />
    </CountsGroup>
  )
}

// Màu khớp 2 thẻ ở trang Đặt máy online: chờ duyệt = warning, đã duyệt = success.
function BookingBadges() {
  const counts = useBookingNavCounts(true)
  const waiting = useNavBadge(counts.waiting)
  const confirmed = useNavBadge(counts.confirmed)
  return (
    <CountsGroup show={waiting.visible || confirmed.visible}>
      <NavCountChip badge={waiting} tone="pending" title="Đơn chờ duyệt" label="Đơn chờ duyệt" />
      <NavCountChip badge={confirmed} tone="confirmed" title="Đơn đã duyệt, chờ khách đến" label="Đơn đã duyệt" />
    </CountsGroup>
  )
}

const SELF_PAYMENT_ICON: Record<SelfPaymentKind, typeof Wallet> = {
  deposit: Wallet,
  combo: Ticket,
  service: CallBell,
  booking: CalendarPlus,
}

// Giao dịch khách tự thanh toán (QR / FZone / online) vừa về: icon loại (cùng icon menu, nạp tiền = ví) + số tiền,
// màu success, hiện 1 phút (nhiều tín hiệu thì lấy cái cuối). 10 giây đầu chớp như các chấm số.
function TransactionBadge() {
  const flash = useSelfPaymentFlash(true)
  if (!flash) return null
  const Icon = SELF_PAYMENT_ICON[flash.kind]
  const amount = formatSelfPaymentAmount(flash.amount)
  const label = `${SELF_PAYMENT_LABEL[flash.kind]}: +${amount} (khách tự thanh toán)`
  return (
    <span className="workspace-nav__counts">
      <span
        className={`workspace-nav__alert workspace-nav__alert--flash workspace-nav__alert--success${flash.pulsing ? ' is-pulsing' : ''}`}
        title={label}
        aria-label={label}
      >
        <Icon size={16} weight="fill" aria-hidden="true" />
        <span className="workspace-nav__alert-text">{amount}</span>
      </span>
    </span>
  )
}

// Cảnh báo phần cứng (GPU -> CPU -> lỗi cảm biến): 1 nhóm, màu warning/danger theo luật trang Theo dõi.
function HealthBadge({ pollNavData }: { pollNavData: boolean }) {
  const alert = useHealthAlertSummary(true, pollNavData)
  if (!alert) return null
  const Icon = alert.device.icon
  const label = `${alert.device.label}: ${alert.count} máy ${alert.tone === 'danger' ? 'có chỉ số nguy hiểm' : 'có cảnh báo'}`
  return (
    <span className="workspace-nav__counts">
      <span
        className={`workspace-nav__alert workspace-nav__alert--${alert.tone}`}
        title={label}
        aria-label={`${alert.device.label}: ${alert.count} máy bị cảnh báo`}
      >
        <Icon size={16} weight="fill" aria-hidden="true" />
        {alert.count}
      </span>
    </span>
  )
}

/** Badge của mục menu theo đường dẫn; mục không có badge trả null. */
export function NavItemBadges({ to, pollNavData }: { to: string; pollNavData: boolean }) {
  switch (to) {
    case '/workstations':
      return <WorkstationBadges pollNavData={pollNavData} />
    case '/orders':
      return <OrderBadges />
    case '/combo_sale':
      return <ComboBadges />
    case '/online-booking':
      return <BookingBadges />
    case '/logs/voucher':
      return <TransactionBadge />
    case '/health_monitor':
      return <HealthBadge pollNavData={pollNavData} />
    default:
      return null
  }
}
