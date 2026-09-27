import type { WsCloseInfo } from '../store/wsStatus'

// 1000/1001: đóng bình thường (chủ động), 1005/1006: trình duyệt tự điền khi KHÔNG xác định được
// lý do thật (mất mạng đột ngột, server chết cứng...) — không mang thông tin gì để hiện cho user.
const AMBIGUOUS_CLOSE_CODES = new Set([1000, 1001, 1005, 1006])

/** null nếu lý do đóng kết nối không rõ ràng (không nên hiện lên UI) — có info thật mới trả text. */
export function describeWsCloseCode(info: WsCloseInfo): string | null {
  if (!info) return null
  const reason = info.reason.trim()
  if (reason) return `Mã ${info.code} · ${reason}`
  if (AMBIGUOUS_CLOSE_CODES.has(info.code)) return null
  return `Mã đóng kết nối ${info.code}`
}
