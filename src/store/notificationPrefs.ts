import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from '../features/notifications/notificationPrefsModel'

/**
 * Thiết lập thông báo nổi / âm báo — lưu theo trình duyệt (localStorage), cùng kiểu `revenuePrefs`.
 * Không có phía server: là tuỳ chọn hiển thị của từng máy thu ngân, không đổi dữ liệu nào.
 * Mặc định = hành vi cũ (toast bật, không âm báo) nên máy chưa cấu hình không đổi gì.
 */
type NotificationPrefsState = NotificationPrefs & {
  setEnabled: (value: boolean) => void
  setSound: (value: boolean) => void
  setGroup: (groupId: string, value: boolean) => void
  setType: (type: string, value: boolean) => void
  reset: () => void
}

export const useNotificationPrefs = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_NOTIFICATION_PREFS,
      setEnabled: (value) => set({ enabled: value }),
      setSound: (value) => set({ sound: value }),
      setGroup: (groupId, value) =>
        set((state) => ({ groups: { ...state.groups, [groupId]: value } })),
      setType: (type, value) => set((state) => ({ types: { ...state.types, [type]: value } })),
      reset: () => set({ ...DEFAULT_NOTIFICATION_PREFS }),
    }),
    {
      name: 'fnet-notification-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      // Chỉ lưu dữ liệu, không lưu hàm action.
      partialize: (state) => ({
        enabled: state.enabled,
        sound: state.sound,
        groups: state.groups,
        types: state.types,
      }),
    },
  ),
)
