import { ApiError } from '../api/client'

/** Dòng mô tả ngắn cho lỗi request (status code) — dùng khi hiện chi tiết lỗi polling cho user. */
export function describeApiErrorCode(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code ? `HTTP ${error.httpStatus} · ${error.code}` : `HTTP ${error.httpStatus}`
  }
  if (error instanceof Error && error.message) return error.message
  return 'Lỗi không xác định'
}
