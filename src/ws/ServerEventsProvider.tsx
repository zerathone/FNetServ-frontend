import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wsClient } from './wsClient'
import { CHAT_QUERY_KEY } from '../api/chat'
import { useAuthStore } from '../store/auth'
import {
  OPERATIONS_NOTIFICATIONS_QUERY_KEY,
  type OperationNotification,
  type OperationNotificationSnapshot,
} from '../api/notifications'
import {
  mergeNotificationEvent,
  notificationDescription,
  notificationIsDisplayable,
} from '../features/notifications/notificationModel'
import { shouldAlert, shouldPlaySound } from '../features/notifications/notificationPrefsModel'
import { playNotificationSound } from '../features/notifications/notificationSound'
import { useNotificationPrefs } from '../store/notificationPrefs'
import { invalidateNotificationDomain } from '../lib/fintechQueries'
import { pushToast } from '../store/toast'

// task 2.23: `workstation.update` / `order.changed` la event THEO SU KIEN (Listener + call-site
// money/combo emit), phong 400 may co the don hang tram event/phut -> moi event 1 lan
// invalidateQueries = bao refetch. Gom bang timer trailing: nhieu event trong cua so -> 1 lan
// invalidate. KHONG debounce `hello` (reconnect phai invalidate ALL ngay -- flow_websocket.md muc 2.3).
const WS_UPDATE_DEBOUNCE_MS = 1500
const ORDER_CHANGED_DEBOUNCE_MS = 1000
const CHAT_INVALIDATE_DEBOUNCE_MS = 300
/** Phản ứng (tim) không cần nhanh: gom ≥ 2 s để không dồn tải server khi nhiều người thả liên tục (D5). */
const CHAT_REACTION_DEBOUNCE_MS = 2000
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
  const chatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatReactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  //   wsClient.send({ type: 'workstation.apps.get', requestId: 'r1', hostName: 'PC-05' })
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
        // Nhóm "Đơn hàng" ở drawer chi tiết máy (trang Máy trạm): GET /workstations/orders.
        void queryClient.invalidateQueries({ queryKey: ['workstation-orders'] })
      }, ORDER_CHANGED_DEBOUNCE_MS)
    }

    const scheduleChatInvalidate = () => {
      if (chatTimerRef.current) clearTimeout(chatTimerRef.current)
      chatTimerRef.current = setTimeout(() => {
        chatTimerRef.current = null
        void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })
      }, CHAT_INVALIDATE_DEBOUNCE_MS)
    }

    // task chat-C9: gom tín hiệu `chat.reaction` rồi chỉ invalidate luồng tin. THROTTLE (không đặt lại timer khi
    // đã có timer): nếu debounce trượt thì người khác bật/tắt 👍 liên tục sẽ làm luồng tin KHÔNG BAO GIỜ được tươi.
    // Tối đa 1 lần tải / 2 s, chậm nhất 2 s sau tín hiệu đầu (D5: ưu tiên an toàn hơn tốc độ).
    const scheduleChatReactionInvalidate = () => {
      if (chatReactTimerRef.current) return
      chatReactTimerRef.current = setTimeout(() => {
        chatReactTimerRef.current = null
        void queryClient.invalidateQueries({ queryKey: [...CHAT_QUERY_KEY, 'messages'] })
      }, CHAT_REACTION_DEBOUNCE_MS)
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
          // Loại không biết + không có tiêu đề: ẩn khỏi hộp thông báo thì cũng không báo toast/âm.
          if (msg.type === 'operation.notification.created' && notificationIsDisplayable(notification)) {
            // Thiết lập thông báo (trang /notification-settings): chỉ chặn toast + âm báo, tin vẫn
            // vào hộp thông báo ở trên. `critical` luôn qua (xem shouldAlert).
            const prefs = useNotificationPrefs.getState()
            if (shouldAlert(prefs, notification)) {
              pushToast(notificationDescription(notification), 'info')
              if (shouldPlaySound(prefs, notification)) playNotificationSound(notification.severity)
            }
          }
          break
        }

        case 'chat.message':
        case 'chat.read':
          // Kênh chat Messenger (task chat-v2/C3): payload chỉ là tín hiệu nhẹ {convId,id,dir,kind} /
          // {convId,who,upToId}; danh sách + luồng + badge lấy lại qua REST. Gom debounce vì khách có thể
          // gõ liên tục. `client.message` cũ vẫn chạy song song (xem case bên dưới).
          // Toast tin nhắn (ChatToastHost) cũng đọc từ cùng queryKey `chat` nên tự làm tươi theo lần invalidate này.
          scheduleChatInvalidate()
          break

        case 'chat.reaction':
          // task chat-C9 (D4/D5): thả tim chỉ là tín hiệu nhẹ — chỉ làm tươi các luồng tin ĐANG MỞ, sau ≥ 2 s
          // (gộp nhiều tín hiệu; ưu tiên an toàn hơn tốc độ). KHÔNG đụng danh sách hội thoại / badge / nút topbar.
          scheduleChatReactionInvalidate()
          break

        case 'tab.notification':
        case 'client.message':
        case 'pong':
        case 'error':
          console.debug(`WS ${msg.type}`, msg.data)
          break

        // task 2.22r-A: đã bỏ case `workstation.volume*` — WebUI không còn chỉnh âm lượng.

        case 'binary':
          // task 2.7b: nền binary (binary_echo). Ảnh chụp màn hình (2.22r) KHÔNG đi đường này —
          // tải qua REST `POST /workstations/screen/image`.
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
      if (chatTimerRef.current) clearTimeout(chatTimerRef.current)
      if (chatReactTimerRef.current) clearTimeout(chatReactTimerRef.current)
      chatReactTimerRef.current = null
      wsUpdateTimerRef.current = null
      orderChangedTimerRef.current = null
      chatTimerRef.current = null
    }
  }, [queryClient])

  return <>{children}</>
}
