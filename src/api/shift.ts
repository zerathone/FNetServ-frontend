// task work-shift S2 (F1) — API "Ca làm việc". Hợp đồng: handoff/HANDOFF_work-shift-S1.md mục 4.3–4.5.
// Server trả dữ liệu thô -> chuẩn hoá ở `features/shifts/shiftModel.ts` (số có thể về dạng chuỗi, thiếu trường...).
// Mock dev: `VITE_SHIFT_MOCK` (xem features/shifts/shiftMock.ts). Bản build luôn là undefined nên nhánh mock bị loại.
import { apiGet, apiPost } from './client'
import {
  normalizeCloseResult,
  normalizeCurrent,
  normalizeShiftInfo,
  normalizeSummary,
} from '../features/shifts/shiftModel'

export type ShiftInfo = {
  shiftId: number
  staffId: number
  staffName: string
  /** 1 đang mở, 2 đã chốt, 3 đóng cưỡng bức. */
  status: number
  /** "YYYY-MM-DD HH:MM:SS" giờ máy chủ. */
  openTime: string
  openingCash: number
}

export type ShiftLastClosed = {
  shiftId: number
  staffName: string
  closeTime: string
  countedCash: number
}

export type ShiftCurrent = {
  /** false = `INT_SHIFT_MODE = 0` -> web phải y hệt trước khi có tính năng ca. */
  enabled: boolean
  mode: number
  serverTime: string
  shift: ShiftInfo | null
  /** Chỉ có khi `shift = null`: ca đã chốt gần nhất toàn quán có tiền thực đếm (gợi ý tiền đầu ca). */
  lastClosed: ShiftLastClosed | null
}

export type ShiftSource = {
  key: string
  name: string
  count: number
  cash: number
  /** Chuyển khoản. */
  online: number
  qr: number
  /** Cấn trừ — CHỈ hiển thị, KHÔNG cộng vào `total` (Q16b). */
  deduct: number
  /** = cash + online + qr (không gồm cấn trừ). */
  total: number
}

export type ShiftRefund = { count: number; cash: number; online: number }

export type ShiftTotals = {
  count: number
  cash: number
  online: number
  qr: number
  deduct: number
  total: number
}

export type ShiftSummary = {
  sources: ShiftSource[]
  refund: ShiftRefund
  totals: ShiftTotals
  expectedCash: number
}

export type ShiftPendingCounts = {
  pendingService: number
  pendingCombo: number
  /** Số đơn món QR đã trả tiền chưa xác nhận (+ tổng tiền nếu server trả). */
  qrPaidUnconfirmed: { count: number; amount: number | null }
}

export type ShiftCloseResult = {
  alreadyClosed: boolean
  shift: ShiftInfo & {
    closeTime: string
    countedCash: number | null
    expectedCash: number | null
    cashDiff: number | null
    note: string
  }
  summary: ShiftSummary | null
  /** Còn ca khác đang mở -> đơn chờ sẽ do ca đó xử lý; chỉ cảnh báo. */
  warnings: ShiftPendingCounts | null
}

const SHIFT_MOCK = (() => {
  const raw = import.meta.env.DEV ? (import.meta.env.VITE_SHIFT_MOCK as string | undefined) : undefined
  return raw && raw !== '0' ? raw : undefined
})()

async function viaMock(path: string, body?: unknown): Promise<{ hit: true; data: unknown } | { hit: false }> {
  if (!SHIFT_MOCK) return { hit: false }
  const { mockShiftRequest } = await import('../features/shifts/shiftMock')
  return { hit: true, data: await mockShiftRequest(SHIFT_MOCK, path, body) }
}

async function call(path: string, body: unknown): Promise<unknown> {
  const mocked = await viaMock(path, body)
  if (mocked.hit) return mocked.data
  return apiPost<unknown, unknown>(path, body)
}

export async function getShiftCurrent(): Promise<ShiftCurrent> {
  const mocked = await viaMock('/shift/current')
  const raw = mocked.hit ? mocked.data : await apiGet<unknown>('/shift/current')
  return normalizeCurrent(raw)
}

export async function openShift(payload: { idem: string; openingCash?: number }) {
  const raw = (await call('/shift/open', payload)) as { shift?: unknown; resumed?: unknown } | undefined
  // Hợp đồng: trả ca (kèm `resumed`). Chấp nhận cả dạng {shift:{...}} lẫn phẳng.
  const info = normalizeShiftInfo(raw && typeof raw === 'object' && 'shift' in raw && raw.shift ? raw.shift : raw)
  return { shift: info, resumed: Boolean(raw && typeof raw === 'object' && (raw as { resumed?: unknown }).resumed) }
}

export async function getShiftSummary(shiftId?: number): Promise<ShiftSummary> {
  return normalizeSummary(await call('/shift/summary', shiftId ? { shiftId } : {}))
}

export async function closeShift(payload: {
  idem: string
  shiftId: number
  countedCash?: number
  note?: string
}): Promise<ShiftCloseResult> {
  return normalizeCloseResult(await call('/shift/close', payload))
}
