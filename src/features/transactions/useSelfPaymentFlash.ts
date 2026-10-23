import { useEffect, useRef, useState } from 'react'
import { getVoucherLogs } from '../../api/logs'
import { NAV_PULSE_MS } from '../../layouts/useNavBadge'
import type { OperationNotification } from '../../api/notifications'
import { wsClient } from '../../ws/wsClient'
import {
  pickLatestSelfPayment,
  SELF_PAYMENT_FLASH_MS,
  type SelfPaymentKind,
} from './selfPaymentModel'

export type SelfPaymentFlash = {
  kind: SelfPaymentKind
  amount: number
  /** true trong NAV_PULSE_MS (10 giây) đầu của lần hiện (chớp), phần còn lại của 1 phút đứng yên cho tới khi tắt. */
  pulsing: boolean
}

// Tín hiệu "có phiếu mới" từ server (NotificationBridge): payment_recorded gộp mọi phiếu ghi nhật ký (kể cả tiền
// mặt, không kèm loại/số tiền); qr_payment_success là nạp ví QR/FZone. Cả hai chỉ dùng làm CÒI -- loại và số tiền
// lấy từ REST /logs/voucher cho đúng.
const SIGNAL_TYPES = new Set(['payment_recorded', 'qr_payment_success'])

function localToday() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/**
 * Giao dịch khách tự thanh toán (QR / FZone / online) mới nhất, hiện ở mục "Giao dịch" của menu trái trong 1 phút.
 * Nhiều tín hiệu tới trong 1 phút thì lấy cái cuối cùng và đếm lại 1 phút.
 *
 * Mốc `voucherId` lớn nhất được ghi nhận lần đầu khi bật hook (không báo lại phiếu cũ); mỗi tín hiệu WS sau đó
 * tải lại phiếu hôm nay và chỉ xét phiếu có id lớn hơn mốc. Chỉ đọc, không ghi gì.
 */
export function useSelfPaymentFlash(enabled: boolean): SelfPaymentFlash | null {
  const [flash, setFlash] = useState<SelfPaymentFlash | null>(null)
  const baselineRef = useRef<number | null>(null)
  const inflightRef = useRef(false)
  const rerunRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const show = (kind: SelfPaymentKind, amount: number) => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      setFlash({ kind, amount, pulsing: true })
      pulseTimerRef.current = setTimeout(() => {
        pulseTimerRef.current = null
        setFlash((current) => (current ? { ...current, pulsing: false } : current))
      }, NAV_PULSE_MS)
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null
        setFlash(null)
      }, SELF_PAYMENT_FLASH_MS)
    }

    const check = async () => {
      // Tín hiệu dồn dập: chỉ 1 request chạy cùng lúc, tín hiệu tới trong lúc đó -> chạy lại đúng 1 lần sau.
      if (inflightRef.current) {
        rerunRef.current = true
        return
      }
      inflightRef.current = true
      try {
        const today = localToday()
        const page = await getVoucherLogs(today, today, 50)
        if (cancelled) return
        const items = page.items ?? []
        if (baselineRef.current === null) {
          // Lần đầu: chỉ ghi mốc, không báo phiếu đã có từ trước.
          baselineRef.current = items.reduce((max, voucher) => Math.max(max, voucher.voucherId), 0)
          return
        }
        const { hit, maxId } = pickLatestSelfPayment(items, baselineRef.current)
        baselineRef.current = maxId
        if (hit) show(hit.kind, hit.amount)
      } catch {
        // Lỗi mạng/quyền: bỏ qua, lần tín hiệu sau thử lại. Mốc giữ nguyên nên không mất phiếu.
      } finally {
        inflightRef.current = false
        if (rerunRef.current && !cancelled) {
          rerunRef.current = false
          void check()
        }
      }
    }

    void check()
    const unsubscribe = wsClient.subscribe((msg) => {
      if (msg.type !== 'operation.notification.created' && msg.type !== 'operation.notification.updated') return
      const notification = msg.data as OperationNotification | undefined
      if (notification && SIGNAL_TYPES.has(notification.type)) void check()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled])

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    },
    [],
  )

  return flash
}
