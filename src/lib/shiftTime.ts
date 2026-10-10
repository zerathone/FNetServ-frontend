/**
 * Mốc bắt đầu "ca" của ô thống kê (BE trả `shiftStart` = "YYYY-MM-DD HH:MM:SS", giờ máy chủ) -> "HH:mm dd/MM".
 * Tách chuỗi bằng regex, KHÔNG qua `Date` để khỏi lệch múi giờ trình duyệt. Sai định dạng / thiếu -> null
 * (BE cũ chưa có field này thì UI chỉ ẩn dòng "Ca từ", không vỡ).
 */
export function formatShiftStart(raw: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(raw ?? '')
  if (!match) return null
  const [, , month, day, hour, minute] = match
  return `${hour}:${minute} ${day}/${month}`
}
