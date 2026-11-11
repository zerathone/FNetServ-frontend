import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBoard, type BoardResponse, type BookedSlot } from '../../api/onlineBooking'
import { useWsStatusStore } from '../../store/wsStatus'
import type { IconReservation } from './workstationModel'

// Icon vé trên ô máy (task ws-status-icons): xanh = có đặt chỗ sắp tới, đỏ = khách đặt chỗ đến trễ.
// Nguồn: /onlinebook/board (cùng API trang Đặt máy online). Dữ liệu là phần BỔ SUNG: lỗi / thiếu quyền /
// tính năng tắt ⇒ không có vé, trang Máy trạm vẫn chạy bình thường (không báo lỗi).

const HORIZON_HOURS = 6
/** Server cũ không trả lockWindowMin (xem BoardResponse) ⇒ web dùng 180, như trang Đặt máy online. */
const DEFAULT_LOCK_WINDOW_MIN = 180
const MS_PER_MIN = 60_000

/**
 * Chỉ tính đơn ĐÃ DUYỆT (confirmed) của kênh online / quầy. Đơn chờ duyệt chưa giữ máy; in_use = chủ đơn đã vào
 * máy; legacy (đặt chỗ kiểu cũ) không theo luật giữ máy trễ nên bỏ.
 *  - reserved: từ (giờ bắt đầu − lockWindowMin) tới giờ bắt đầu — đúng lúc guard login bắt đầu chặn người khác.
 *  - late: đã quá giờ bắt đầu mà chủ đơn chưa vào; kéo dài tới hết lateHoldMin (0 = tới hết khung đặt).
 */
export function classifyReservation(
  slots: readonly BookedSlot[],
  nowMs: number,
  lockWindowMin: number,
  lateHoldMin: number,
): IconReservation | null {
  let result: IconReservation | null = null
  for (const slot of slots) {
    if (slot.state !== 'confirmed' || slot.source === 'legacy') continue
    const from = Date.parse(slot.from)
    const to = Date.parse(slot.to)
    if (Number.isNaN(from) || Number.isNaN(to)) continue

    if (nowMs < from) {
      if (from - nowMs <= lockWindowMin * MS_PER_MIN) result = result ?? 'reserved'
    } else if (nowMs < to) {
      const holdEnd = lateHoldMin > 0 ? Math.min(to, from + lateHoldMin * MS_PER_MIN) : to
      if (nowMs < holdEnd) return 'late' // trễ ưu tiên hơn mọi đơn sắp tới của cùng máy
    }
  }
  return result
}

function buildReservationMap(board: BoardResponse, nowMs: number): ReadonlyMap<string, IconReservation> {
  const map = new Map<string, IconReservation>()
  if (!board.enabled) return map
  const lockWindow = board.lockWindowMin ?? DEFAULT_LOCK_WINDOW_MIN
  for (const machine of board.machines) {
    const kind = classifyReservation(machine.bookedSlots, nowMs, lockWindow, board.lateHoldMin ?? 0)
    if (kind) map.set(machine.pc.toUpperCase(), kind)
  }
  return map
}

const EMPTY: ReadonlyMap<string, IconReservation> = new Map()

/**
 * Khóa tra cứu = tên máy IN HOA (server cũng so tên máy không phân biệt hoa thường).
 * `nowMs` làm tròn 10 giây để không dựng lại Map mỗi giây khi trang đang chạy đồng hồ.
 */
export function useWorkstationReservations(nowMs: number): ReadonlyMap<string, IconReservation> {
  const connected = useWsStatusStore((state) => state.connected)
  const query = useQuery({
    queryKey: ['ws-reservations'],
    queryFn: () => getBoard({ horizonHours: HORIZON_HOURS }),
    // Lỗi (thiếu quyền, server cũ…) ⇒ dừng poll, không spam server mỗi chu kỳ.
    refetchInterval: (q) => (q.state.status === 'error' ? false : connected ? 30_000 : 10_000),
    retry: false,
  })

  const board = query.data
  const dataUpdatedAt = query.dataUpdatedAt
  const tick = Math.floor(nowMs / 10_000)

  return useMemo(() => {
    if (!board) return EMPTY
    // Quy về giờ máy chủ: cộng độ lệch (giờ server lúc trả − giờ trình duyệt lúc nhận) vào giờ trình duyệt hiện tại.
    const serverAtFetch = Date.parse(board.serverTime)
    const drift = Number.isNaN(serverAtFetch) ? 0 : serverAtFetch - dataUpdatedAt
    return buildReservationMap(board, tick * 10_000 + drift)
  }, [board, dataUpdatedAt, tick])
}
