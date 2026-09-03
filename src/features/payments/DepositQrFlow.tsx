import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelDepositQr,
  getDepositQrStatus,
  startDepositQr,
  type DepositQrStartResult,
  type DepositQrState,
} from '../../api/deposit'
import { Button, InlineAlert } from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { pushToast } from '../../store/toast'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import {
  createCustomerQrDisplayChannel,
  customerQrDisplayChannelName,
  openCustomerQrDisplay,
  type CustomerQrDisplayState,
} from './CustomerQrDisplay'
import './deposit-method.css'

type DepositQrFlowProps = {
  userId: number
  amount: number | null
  disabled?: boolean
  onActiveChange?: (active: boolean) => void
}

const TERMINAL_STATES = new Set<DepositQrState>([
  'done',
  'failed',
  'expired',
  'cancelled',
  'sent_to_workstation',
])

function stateLabel(state: DepositQrState) {
  switch (state) {
    case 'pending':
      return 'Chờ khách quét mã'
    case 'processing':
      return 'Đang xác nhận thanh toán'
    case 'done':
      return 'Nạp tiền thành công'
    case 'failed':
      return 'Thanh toán thất bại'
    case 'expired':
      return 'Mã QR đã hết hạn'
    case 'cancelled':
      return 'Đã dừng chờ tại quầy'
    case 'sent_to_workstation':
      return 'Đã gửi QR xuống máy trạm'
  }
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(
    safe % 60,
  ).padStart(2, '0')}`
}

export function DepositQrFlow({
  userId,
  amount,
  disabled = false,
  onActiveChange,
}: DepositQrFlowProps) {
  const queryClient = useQueryClient()
  const { getKey, clearKey } = useIdempotentIntent('member-deposit-qr')
  const [intent, setIntent] = useState<DepositQrStartResult | null>(null)
  const [state, setState] = useState<DepositQrState | null>(null)
  const [message, setMessage] = useState('')
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [expiresAtClientMs, setExpiresAtClientMs] = useState(0)
  const customerDisplayChannelRef = useRef<BroadcastChannel | null>(null)
  const customerDisplayChannelIdRef = useRef<string | null>(null)
  const customerDisplayStateRef = useRef<CustomerQrDisplayState | null>(null)
  const customerDisplayPopupRef = useRef<Window | null>(null)

  const active = Boolean(state && !TERMINAL_STATES.has(state))

  useEffect(() => {
    if (!active || !intent || !expiresAtClientMs) return
    const timer = window.setInterval(() => {
      setRemainingSeconds(
        Math.max(0, Math.ceil((expiresAtClientMs - Date.now()) / 1_000)),
      )
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [active, expiresAtClientMs, intent])

  const startMutation = useMutation({
    mutationFn: () => {
      if (!amount || amount < 10_000) {
        throw new Error('Số tiền tối thiểu để dùng QR là 10.000 đ.')
      }
      const payload = {
        userId,
        chargeMoney: amount,
      }
      return startDepositQr({
        ...payload,
        idem: getKey(fingerprintIntent(payload)),
      })
    },
    onSuccess: (result) => {
      setIntent(result)
      setState(result.state)
      setMessage('')
      if (result.presentation === 'counter') {
        const expiresInSeconds = Math.max(0, result.expiresInSeconds ?? 0)
        const clientExpiresAt = Date.now() + expiresInSeconds * 1_000
        setExpiresAtClientMs(clientExpiresAt)
        setRemainingSeconds(expiresInSeconds)
      } else {
        setExpiresAtClientMs(0)
        setRemainingSeconds(0)
      }
    },
    onError: (error) => {
      setState('failed')
      setMessage(error.message)
    },
  })

  const blocksClose = startMutation.isPending || active

  useEffect(() => {
    onActiveChange?.(blocksClose)
  }, [blocksClose, onActiveChange])

  const statusQuery = useQuery({
    queryKey: ['deposit-qr-status', intent?.orderId],
    queryFn: () => getDepositQrStatus(intent!.orderId!),
    enabled: Boolean(
      intent?.presentation === 'counter' && intent.orderId && active,
    ),
    retry: false,
    refetchInterval: active ? 1_000 : false,
  })

  useEffect(() => {
    const result = statusQuery.data
    if (!result) return
    if (
      (state === 'expired' || state === 'cancelled') &&
      result.state !== 'done'
    ) {
      return
    }
    if (result.state === state) return
    setState(result.state)
    setMessage('')
    if (result.state === 'done') {
      clearKey()
      pushToast('Nạp tiền QR thành công.', 'success')
      void invalidateMoneyQueries(queryClient)
    }
  }, [clearKey, queryClient, state, statusQuery.data])

  useEffect(() => {
    if (
      remainingSeconds !== 0 ||
      !active ||
      intent?.presentation !== 'counter'
    ) {
      return
    }
    setState('expired')
    setMessage(
      'Mã đã hết thời gian chờ. Khoản quét sát thời điểm hết hạn vẫn có thể được cổng thanh toán ghi nhận; hãy kiểm tra nhật ký trước khi tạo mã khác.',
    )
    clearKey()
    void cancelDepositQr().catch((error: Error) => {
      setMessage(`Không dọn được trạng thái chờ: ${error.message}`)
    })
  }, [active, clearKey, intent, remainingSeconds])

  const cancelMutation = useMutation({
    mutationFn: cancelDepositQr,
    onSuccess: (result) => {
      clearKey()
      setState(result.state)
      setMessage('Khoản đã quét sát thời điểm dừng vẫn có thể được cổng thanh toán ghi nhận.')
    },
    onError: (error) => setMessage(error.message),
  })

  const statusTone = useMemo(() => {
    if (state === 'done') return 'success' as const
    if (state === 'failed' || state === 'expired') {
      return 'danger' as const
    }
    if (state === 'cancelled') return 'warning' as const
    return 'info' as const
  }, [state])
  const safeQrImage = intent?.qrImageDataUrl ?? ''
  const qrCancelled = state === 'cancelled' || cancelMutation.isPending
  const customerDisplayState: CustomerQrDisplayState | null =
    intent?.presentation === 'counter' && safeQrImage && state
      ? {
          qrImageDataUrl: safeQrImage,
          recipient: intent.bankUser ?? '',
          bankName: intent.bankShortName ?? intent.bankName ?? '',
          bankAccount: intent.bankAccount ?? '',
          amount: intent.value ?? amount ?? 0,
          expiresAtMs: expiresAtClientMs,
          state: qrCancelled ? 'cancelled' : state,
        }
      : null

  customerDisplayStateRef.current = customerDisplayState

  useEffect(() => {
    if (!customerDisplayState) return
    customerDisplayChannelRef.current?.postMessage({
      type: 'display',
      payload: customerDisplayState,
    })
  }, [customerDisplayState])

  useEffect(() => () => {
    customerDisplayChannelRef.current?.postMessage({ type: 'ended' })
    customerDisplayChannelRef.current?.close()
    if (customerDisplayPopupRef.current && !customerDisplayPopupRef.current.closed) {
      customerDisplayPopupRef.current.close()
    }
  }, [])

  const openCustomerDisplay = () => {
    if (!customerDisplayState) return
    let channel = customerDisplayChannelRef.current
    if (!channel) {
      const channelId = createCustomerQrDisplayChannel()
      customerDisplayChannelIdRef.current = channelId
      channel = new BroadcastChannel(customerQrDisplayChannelName(channelId))
      channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
        if (event.data.type === 'ready' && customerDisplayStateRef.current) {
          channel?.postMessage({ type: 'display', payload: customerDisplayStateRef.current })
        }
      }
      customerDisplayChannelRef.current = channel
    }

    const popup = openCustomerQrDisplay(customerDisplayChannelIdRef.current!)
    if (!popup) {
      pushToast('Trình duyệt đang chặn popup. Hãy cho phép mở cửa sổ QR cho trang này.', 'info')
      return
    }
    customerDisplayPopupRef.current = popup
    channel.postMessage({ type: 'display', payload: customerDisplayState })
    popup.focus()
  }

  const endCustomerDisplay = () => {
    customerDisplayChannelRef.current?.postMessage({ type: 'ended' })
    customerDisplayChannelRef.current?.close()
    if (customerDisplayPopupRef.current && !customerDisplayPopupRef.current.closed) {
      customerDisplayPopupRef.current.close()
    }
    customerDisplayChannelRef.current = null
    customerDisplayChannelIdRef.current = null
    customerDisplayPopupRef.current = null
  }

  if (!intent) {
    return (
      <div className="deposit-qr-flow">
        {startMutation.isError ? (
          <InlineAlert tone="danger">
            {startMutation.error.message}
          </InlineAlert>
        ) : (
          <InlineAlert tone="info">
            Máy chủ sẽ tự chọn nơi hiển thị: gửi tới máy trạm của hội viên đang
            online, hoặc hiện QR tại quầy khi hội viên offline.
          </InlineAlert>
        )}
        <Button
          type="button"
          variant="primary"
          loading={startMutation.isPending}
          disabled={disabled || !amount || amount < 10_000}
          onClick={() => startMutation.mutate()}
        >
          Tạo mã QR
        </Button>
      </div>
    )
  }

  return (
    <section className="deposit-qr-flow" aria-live="polite">
      <InlineAlert tone={statusTone}>
        <strong>{state ? stateLabel(state) : 'Đang xử lý'}</strong>
        {message ? ` · ${message}` : ''}
      </InlineAlert>

      {intent.presentation === 'workstation' ? (
        <div className="deposit-qr-flow__target">
          <span>Mã QR đã được gửi tới</span>
          <strong>{intent.hostName || 'máy trạm của hội viên'}</strong>
        </div>
      ) : safeQrImage ? (
        <div className={`deposit-qr-flow__visual${qrCancelled ? ' is-cancelled' : ''}`}>
          <div className="deposit-qr-flow__code">
            <img src={safeQrImage} alt={qrCancelled ? 'Mã QR đã ngừng hiệu lực' : 'Mã QR nạp tiền hội viên'} />
          </div>
          <dl>
            <div><dt>Người nhận</dt><dd>{intent.bankUser || '—'}</dd></div>
            <div><dt>Ngân hàng</dt><dd>{intent.bankShortName || intent.bankName || '—'}</dd></div>
            <div><dt>Số tài khoản</dt><dd>{intent.bankAccount || '—'}</dd></div>
          </dl>
        </div>
      ) : (
        <InlineAlert tone="danger">
          Máy chủ chưa trả ảnh QR có thể hiển thị an toàn.
        </InlineAlert>
      )}

      {active ? (
        <div className="deposit-qr-flow__countdown">
          <span>Hết hạn sau</span>
          <strong>{formatCountdown(remainingSeconds)}</strong>
        </div>
      ) : null}

      {statusQuery.isError ? (
        <InlineAlert tone="warning">
          Mất kết nối khi đọc trạng thái. WebUI sẽ tiếp tục dùng cùng mã giao dịch
          khi thử lại, không tạo giao dịch QR thứ hai.
        </InlineAlert>
      ) : null}

      <div className="deposit-qr-flow__actions">
        {active && intent.presentation === 'counter' ? (
          <>
            <Button type="button" variant="secondary" onClick={openCustomerDisplay}>
              Mở màn hình QR cho khách
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Dừng chờ tại quầy
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              endCustomerDisplay()
              clearKey()
              setIntent(null)
              setState(null)
              setMessage('')
              setExpiresAtClientMs(0)
              setRemainingSeconds(0)
            }}
          >
            Tạo giao dịch QR mới
          </Button>
        )}
      </div>
    </section>
  )
}
