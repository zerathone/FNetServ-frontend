import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * Tuỳ chọn hiển thị doanh thu, dùng chung cho thẻ "Doanh thu" của trang Đơn dịch vụ và Đặt máy.
 * deductInRevenue = false (mặc định, chốt 2026-10-21): doanh thu KHÔNG gồm cấn trừ (trừ vào số dư ví hội viên, không phải
 * tiền thu mới). Bật (check): cấn trừ được cộng vào doanh thu. Chỉ ảnh hưởng cách hiển thị trên máy này — không đổi dữ liệu / báo cáo.
 */
type RevenuePrefsState = {
  deductInRevenue: boolean
  setDeductInRevenue: (value: boolean) => void
}

export const useRevenuePrefs = create<RevenuePrefsState>()(
  persist(
    (set) => ({
      deductInRevenue: false,
      setDeductInRevenue: (value) => set({ deductInRevenue: value }),
    }),
    // Tên khoá v2: bỏ giá trị cũ (mặc định trước đây là true) để mọi máy bắt đầu từ mặc định mới.
    { name: 'fnet-revenue-prefs-v2', storage: createJSONStorage(() => localStorage) },
  ),
)
