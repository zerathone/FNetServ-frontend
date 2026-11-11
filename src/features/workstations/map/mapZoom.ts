// Mức phóng to / thu nhỏ của sơ đồ máy trạm (thanh trượt). TỐI ĐA 5 mức (user chốt 2026-11-11), có chặn min/max hợp lý.
// Hàm thuần — hook lưu lựa chọn nằm ở useMapZoom.ts.

/** Màn thu ngân: hệ số nhân kích thước ô + hình máy + huy hiệu. Mức giữa (1×) = kích thước gốc của hình máy. */
export const VIEW_ZOOM_LEVELS = [0.7, 0.85, 1, 1.25, 1.5] as const
export const VIEW_ZOOM_DEFAULT_INDEX = 2

/** Trình chỉnh sửa: cỡ ô (px). Nhỏ nhất vẫn đọc được tên máy, lớn nhất vẫn vừa ~1/2 màn hình ở lưới 20 cột. */
export const EDITOR_ZOOM_PX = [36, 46, 56, 72, 92] as const
export const EDITOR_ZOOM_DEFAULT_INDEX = 2

export const VIEW_ZOOM_STORAGE_KEY = 'fnet.workstations.map-zoom.v1'
export const EDITOR_ZOOM_STORAGE_KEY = 'fnet.workstations.map-editor-zoom.v1'

/** Kẹp chỉ số về [0, count-1]; giá trị rác (NaN, không nguyên) ⇒ mặc định. */
export function clampZoomIndex(value: number, count: number, fallback: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(count - 1, Math.max(0, value))
}

/** Đọc chỉ số đã lưu; trình duyệt chặn lưu trữ / dữ liệu hỏng ⇒ mặc định. */
export function readStoredZoomIndex(key: string, count: number, fallback: number) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return clampZoomIndex(Number(raw), count, fallback)
  } catch {
    return fallback
  }
}
