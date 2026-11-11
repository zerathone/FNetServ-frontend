// Mức phóng to / thu nhỏ của sơ đồ máy trạm (thanh trượt). TỐI ĐA 5 mức; user chốt 2026-11-11: MIN 50%, MAX 125%.
// Hàm thuần — hook lưu lựa chọn nằm ở useMapZoom.ts.

/** Màn thu ngân: hệ số nhân kích thước ô + hình máy + huy hiệu. 1× (100%) = kích thước gốc của hình máy. */
export const VIEW_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25] as const
export const VIEW_ZOOM_DEFAULT_INDEX = 2

/**
 * Trình chỉnh sửa: cỡ ô (px) — cùng tỉ lệ 50% / 75% / 100% / 125% quanh mức 100% = 56px.
 * (Ở 50% ô chỉ 28px: tên máy vẫn đọc được nhờ cỡ chữ tối thiểu 9px trong map.css.)
 */
export const EDITOR_ZOOM_PX = [28, 42, 56, 70] as const
export const EDITOR_ZOOM_DEFAULT_INDEX = 2

// v2: bộ mức đổi (50–125%) nên không dùng lại chỉ số đã lưu của bản 5 mức cũ (70–150%).
export const VIEW_ZOOM_STORAGE_KEY = 'fnet.workstations.map-zoom.v2'
export const EDITOR_ZOOM_STORAGE_KEY = 'fnet.workstations.map-editor-zoom.v2'

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