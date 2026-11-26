import { ApiError } from '../../api/client'
import { Button, StateView } from '../../design-system/components'
import '../../pages/settings.css'
import './settings-ops.css'

/** Máy chủ cũ chưa có route mới ⇒ 404 (hoặc thông điệp "not found"). */
function isOldServerError(error: unknown): boolean {
  if (error instanceof ApiError) return error.httpStatus === 404 || /not found/i.test(error.message)
  return false
}

/**
 * Trạng thái lỗi tải của một khối thiết lập bổ sung. Máy chủ cũ (404) ⇒ báo "cần cập nhật Server" thay vì thông điệp
 * kỹ thuật, và không làm vỡ phần còn lại của trang.
 */
export function OpsErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const oldServer = isOldServerError(error)
  return (
    <StateView
      title={oldServer ? 'Cần cập nhật Server' : 'Không tải được cấu hình'}
      description={
        oldServer
          ? 'Máy chủ đang chạy chưa hỗ trợ cài đặt này. Hãy cập nhật Server lên bản mới rồi tải lại trang.'
          : error instanceof Error
            ? error.message
            : 'Không tải được cấu hình từ máy chủ.'
      }
      action={<Button onClick={onRetry}>Thử lại</Button>}
    />
  )
}
