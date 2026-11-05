import { HandCoins, Money, Wallet } from '@phosphor-icons/react'
import type { PendingPayKind } from './pendingServiceModel'

/** Icon hình thức thanh toán của một mục "Dịch vụ chờ": tiền mặt / cấn trừ / khách nạp tiền; không rõ thì không icon. */
export function PendingPayIcon({ kind }: { kind: PendingPayKind }) {
  if (kind === 'cash') return <Money size={14} weight="fill" className="is-cash" aria-label="Tiền mặt" />
  if (kind === 'deduct') return <HandCoins size={14} weight="fill" className="is-deduct" aria-label="Cấn trừ" />
  if (kind === 'request') return <Wallet size={14} weight="fill" className="is-request" aria-label="Khách nạp tiền" />
  return null
}
