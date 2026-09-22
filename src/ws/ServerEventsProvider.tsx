import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wsClient } from './wsClient'
import { useAuthStore } from '../store/auth'
import {
  OPERATIONS_NOTIFICATIONS_QUERY_KEY,
  type OperationNotification,
  type OperationNotificationSnapshot,
} from '../api/notifications'
import { mergeNotificationEvent, notificationDescription } from '../features/notifications/notificationModel'
import { invalidateNotificationDomain } from '../lib/fintechQueries'
import { pushToast } from '../store/toast'

// task 2.23: `workstation.update` / `order.changed` la event THEO SU KIEN (Listener + call-site
// money/combo emit), phong 400 may co the don hang tram event/phut -> moi event 1 lan
// invalidateQueries = bao refetch. Gom bang timer trailing: nhieu event trong cua so -> 1 lan
// invalidate. KHONG debounce `hello` (reconnect phai invalidate ALL ngay -- flow_websocket.md muc 2.3).
const WS_UPDATE_DEBOUNCE_MS = 1500
const ORDER_CHANGED_DEBOUNCE_MS = 1000
const SUBSCRIBED_DOMAINS = [
  'workstation',
  'order',
  'member',
  'chat',
  'config',
  'payment',
  'system',
  'notification',
]

export function ServerEventsProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const token = useAuthStore((state) => state.token)
  const helloCountRef = useRef(0)
  const wsUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orderChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (token) {
      wsClient.setDomains(SUBSCRIBED_DOMAINS)
      wsClient.connect(token)
    } else {
      wsClient.disconnect()
      helloCountRef.current = 0
    }
  }, [token])

  // task 2.7b: dev-only — cho test-card gọi lệnh C->S từ DevTools console, ví dụ:
  //   wsClient.send({ type: 'workstation.volume.get', hostName: 'PC-05' })
  //   wsClient.sendBinary(new TextEncoder().encode('hello').buffer)  // server echo lại
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as { wsClient: typeof wsClient }).wsClient = wsClient
    }
  }, [])

  useEffect(() => {
    const scheduleWorkstationsInvalidate = () => {
      if (wsUpdateTimerRef.current) clearTimeout(wsUpdateTimerRef.current)
      wsUpdateTimerRef.current = setTimeout(() => {
        wsUpdateTimerRef.current = null
        void queryClient.invalidateQueries({ queryKey: ['workstations'] })
      }, WS_UPDATE_DEBOUNCE_MS)
    }

    const scheduleOrdersInvalidate = () => {
      if (orderChangedTimerRef.current) clearTimeout(orderChangedTimerRef.current)
      orderChangedTimerRef.current = setTimeout(() => {
        orderChangedTimerRef.current = null
        void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
        void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
      }, ORDER_CHANGED_DEBOUNCE_MS)
    }

    const unsubscribe = wsClient.subscribe((msg) => {
      switch (msg.type) {
        case 'hello':
          helloCountRef.current += 1
          if (helloCountRef.current >= 2) {
            // Reconnect thành công sau khi rớt -> invalidate TOÀN BỘ
            queryClient.removeQueries({ queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY })
            void queryClient.invalidateQueries()
          }
          console.debug('WS hello', msg.data)
          break

        case 'workstation.update':
          // task 2.23: debounce ~1500ms (payload chỉ là signal, snapshot lấy qua REST)
          scheduleWorkstationsInvalidate()
          break

        case 'order.changed':
          // task 2.24: DÙNG CHUNG 1 event cho cả 2 tab của Order Queue — combo mua bằng tiền mặt
          // cũng emit WM_SET_SERVICE_ORDER_COLOR (ComboHandlers.cpp:648) và bridge đã dịch sang
          // `order.changed`, nên chỉ cần thêm queryKey của tab combo, KHÔNG thêm message WS mới.
          // task 2.23: debounce ~1000ms cùng cơ chế.
          scheduleOrdersInvalidate()
          break

        case 'member.updated': {
          // Signal-only: số dư thật vẫn lấy qua REST. task 2.44-A3: memberId > 0 ở 6 call-site
          // mới (§16.1-IMPL) cho phép refetch đúng 1 hội viên; 2 nguồn cũ vẫn phát 0 -> refetch rộng.
          const memberId = (msg.data as { memberId?: number } | undefined)?.memberId ?? 0
          void queryClient.invalidateQueries({ queryKey: ['users'] })
          void queryClient.invalidateQueries({
            queryKey: memberId > 0 ? ['user-detail', memberId] : ['user-detail'],
          })
          void queryClient.invalidateQueries({ queryKey: ['workstation-user'] })
          void queryClient.invalidateQueries({ queryKey: ['workstations'] })
          break
        }

        case 'usergroup.changed':
          void queryClient.invalidateQueries({ queryKey: ['user-groups'] })
          break

        case 'promotion.changed':
          void queryClient.invalidateQueries({ queryKey: ['promotions'] })
          break

        case 'webblock.changed':
          void queryClient.invalidateQueries({ queryKey: ['webblock'] })
          break

        case 'paymentwait.changed':
          void queryClient.invalidateQueries({ queryKey: ['payment-wait'] })
          void queryClient.invalidateQueries({ queryKey: ['workstations'] })
          break

        case 'operation.notification.created':
        case 'operation.notification.updated': {
          const notification = msg.data as OperationNotification
          queryClient.setQueryData<OperationNotificationSnapshot>(
            OPERATIONS_NOTIFICATIONS_QUERY_KEY,
            (current) => mergeNotificationEvent(current, notification),
          )
          if (!queryClient.getQueryData(OPERATIONS_NOTIFICATIONS_QUERY_KEY)) {
            void queryClient.invalidateQueries({ queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY })
          }
          void invalidateNotificationDomain(queryClient, notification)
          if (msg.type === 'operation.notification.created') {
            pushToast(notificationDescription(notification), 'info')
          }
          break
        }

        case 'tab.notification':
        case 'client.message':
        case 'pong':
        case 'error':
          console.debug(`WS ${msg.type}`, msg.data)
          break

        // task 2.7b — lát cắt round-trip volume: hiện chỉ log (UI đầy đủ để 2.22).
        // Consumer thật ở 2.22 sẽ LỌC theo hostName máy đang mở.
        case 'workstation.volume.requested':
        case 'workstation.volume':
          console.debug(`WS ${msg.type}`, msg.data)
          break

        case 'binary':
          // task 2.7b: nền binary (binary_echo). 2.22 screen sẽ giải mã ArrayBuffer thành ảnh.
          console.debug('WS binary frame', (msg.data as ArrayBuffer)?.byteLength, 'bytes')
          break

        default:
          // Ignore unknown types
          break
      }
    })

    return () => {
      unsubscribe()
      if (wsUpdateTimerRef.current) clearTimeout(wsUpdateTimerRef.current)
      if (orderChangedTimerRef.current) clearTimeout(orderChangedTimerRef.current)
      wsUpdateTimerRef.current = null
      orderChangedTimerRef.current = null
    }
  }, [queryClient])

  return <>{children}</>
}
