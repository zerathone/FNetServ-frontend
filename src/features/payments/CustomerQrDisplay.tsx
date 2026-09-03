import { useEffect, useState } from 'react'
import './customer-qr-display.css'

const CHANNEL_PREFIX = 'fnet-customer-qr:'

export type CustomerQrDisplayState = {
  kind?: 'deposit' | 'mobile-pair'
  qrImageDataUrl: string
  recipient?: string
  bankName?: string
  bankAccount?: string
  amount?: number
  expiresAtMs: number
  state: 'pending' | 'processing' | 'cancelled' | 'done' | 'expired' | 'failed' | 'sent_to_workstation'
}

type CustomerQrDisplayMessage =
  | { type: 'ready' }
  | { type: 'display'; payload: CustomerQrDisplayState }
  | { type: 'ended' }

export function createCustomerQrDisplayChannel() {
  return crypto.randomUUID()
}

export function customerQrDisplayChannelName(channelId: string) {
  return `${CHANNEL_PREFIX}${channelId}`
}

export function openCustomerQrDisplay(channelId: string) {
  const popup = window.open(
    `/customer-qr?channel=${encodeURIComponent(channelId)}`,
    'fnet-customer-qr',
    'popup=yes,width=520,height=740,resizable=yes,scrollbars=no',
  )
  movePopupToSecondaryScreen(popup)
  return popup
}

function movePopupToSecondaryScreen(popup: Window | null) {
  if (!popup) return
  type ScreenDetails = {
    screens: Array<{ isPrimary?: boolean; availLeft: number; availTop: number; availWidth: number; availHeight: number }>
  }
  const getScreenDetails = (window as unknown as {
    getScreenDetails?: () => Promise<ScreenDetails>
  }).getScreenDetails
  if (!getScreenDetails) return

  void getScreenDetails().then(({ screens }) => {
    const secondary = screens.find((screen) => !screen.isPrimary)
    if (!secondary || popup.closed) return
    popup.moveTo(secondary.availLeft, secondary.availTop)
    popup.resizeTo(Math.min(520, secondary.availWidth), Math.min(740, secondary.availHeight))
  }).catch(() => undefined)
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function statusLabel(state: CustomerQrDisplayState['state']) {
  switch (state) {
    case 'processing': return 'Đang xác nhận thanh toán'
    case 'cancelled': return 'Mã QR đã ngừng hiệu lực'
    case 'done': return 'Thanh toán thành công'
    case 'expired': return 'Mã QR đã hết hạn'
    case 'failed': return 'Thanh toán thất bại'
    default: return 'Quét mã để thanh toán'
  }
}

export function CustomerQrDisplay() {
  const [display, setDisplay] = useState<CustomerQrDisplayState | null>(null)
  const [ended, setEnded] = useState(false)
  const [nowMs, setNowMs] = useState(Date.now())
  const channelId = new URLSearchParams(window.location.search).get('channel')

  useEffect(() => {
    if (!channelId) return
    const channel = new BroadcastChannel(customerQrDisplayChannelName(channelId))
    const receive = (event: MessageEvent<CustomerQrDisplayMessage>) => {
      if (event.data.type === 'display') {
        setDisplay(event.data.payload)
        setEnded(false)
      }
      if (event.data.type === 'ended') setEnded(true)
    }
    channel.addEventListener('message', receive)
    channel.postMessage({ type: 'ready' } satisfies CustomerQrDisplayMessage)
    return () => {
      channel.removeEventListener('message', receive)
      channel.close()
    }
  }, [channelId])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const remainingSeconds = display && !ended
    ? Math.max(0, Math.ceil((display.expiresAtMs - nowMs) / 1_000))
    : 0
  const unavailable = ended || !display || display.state !== 'pending' || remainingSeconds === 0
  const isMobilePair = display?.kind === 'mobile-pair'

  return (
    <main className="customer-qr-display">
      <p className="customer-qr-display__eyebrow">{isMobilePair ? 'Kết nối tài khoản' : 'Thanh toán QR'}</p>
      {!display ? (
        <section className="customer-qr-display__empty">
          {channelId ? 'Đang chờ mã QR từ quầy…' : 'Liên kết màn hình QR không hợp lệ.'}
        </section>
      ) : (
        <section className={`customer-qr-display__card${unavailable ? ' is-unavailable' : ''}`}>
          <p className="customer-qr-display__status">{ended ? 'Phiên QR đã kết thúc' : isMobilePair ? 'Quét QR bằng ứng dụng FZone' : statusLabel(display.state)}</p>
          <h1>{isMobilePair ? 'Kết nối mobile' : formatMoney(display.amount ?? 0)}</h1>
          <div className="customer-qr-display__code">
            <img
              src={display.qrImageDataUrl}
              alt={unavailable ? 'Mã QR không còn hiệu lực' : 'Mã QR thanh toán'}
            />
            {unavailable ? <span>Mã QR không còn hiệu lực</span> : null}
          </div>
          {!isMobilePair ? (
            <dl>
              <div><dt>Người nhận</dt><dd>{display.recipient || '—'}</dd></div>
              <div><dt>Ngân hàng</dt><dd>{display.bankName || '—'}</dd></div>
              <div><dt>Số tài khoản</dt><dd>{display.bankAccount || '—'}</dd></div>
            </dl>
          ) : null}
          <div className="customer-qr-display__countdown">
            <span>Hết hạn sau</span>
            <strong>{formatCountdown(remainingSeconds)}</strong>
          </div>
        </section>
      )}
    </main>
  )
}
