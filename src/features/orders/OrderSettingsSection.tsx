import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import { ORDER_QUEUE_MAX_MINUTES, updateOrderConfig, type OrderConfig } from '../../api/settings'
import { Button, InlineAlert, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  normalizeQueue,
  ORDER_CONFIG_QUERY_KEY,
  useOrderConfigQuery,
  validateQueueThresholds,
} from './useOrderQueueConfig'

function describeError(err: Error) {
  if (err instanceof ApiError && (err.httpStatus === 404 || err.httpStatus === 501)) {
    return 'Máy chủ hiện chưa hỗ trợ cài đặt đơn hàng (cần cập nhật Server).'
  }
  if (err.message === 'forbidden') return 'Chỉ quản trị viên được thay đổi cài đặt đơn hàng.'
  return err.message
}

/**
 * Cài đặt → "Đơn hàng": chỗ chứa mọi cấu hình order (object `/settings/order`, mỗi nhóm một khối). Nhóm đầu tiên:
 * "Hàng đơn chờ" — ngưỡng nhãn vàng/đỏ cho thẻ đơn chờ (/orders, Combo chờ duyệt, chip đơn chờ ở Máy trạm).
 * Mọi nhân viên xem được (thẻ đơn cần ngưỡng); chỉ quản trị viên lưu được (server từ chối người khác).
 */
export function OrderSettingsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useOrderConfigQuery()
  const [warn, setWarn] = useState(10)
  const [danger, setDanger] = useState(20)
  const [error, setError] = useState('')

  // Form là bản nháp cục bộ nên đồng bộ theo dữ liệu server khi tải/lưu xong.
  useEffect(() => {
    if (query.data) {
      const q = normalizeQueue(query.data.queue)
      setWarn(q.warn)
      setDanger(q.danger)
    }
  }, [query.data])

  const mutation = useMutation({
    mutationFn: updateOrderConfig,
    onSuccess: (data: OrderConfig) => {
      queryClient.setQueryData(ORDER_CONFIG_QUERY_KEY, data)
      setError('')
      pushToast('Đã lưu cài đặt hàng đơn chờ.', 'success')
    },
    onError: (err: Error) => setError(describeError(err)),
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    const invalid = validateQueueThresholds(warn, danger)
    setError(invalid ?? '')
    if (invalid) return
    // Gửi TỪNG PHẦN — chỉ nhóm queue; các nhóm khác (sau này) server giữ nguyên.
    mutation.mutate({ queue: { warn, danger } })
  }

  const unsupported =
    query.isError && query.error instanceof ApiError && (query.error.httpStatus === 404 || query.error.httpStatus === 501)

  return (
    <form className="settings-section" onSubmit={save}>
      <header>
        <h2>Hàng đơn chờ</h2>
        <p>
          Thẻ đơn chờ đổi màu theo thời gian khách đã chờ. Quá mức đỏ: đầu danh sách hiện dải cảnh báo, đơn có
          topping/công thức ghi rõ đang giữ nguyên liệu. Chỉ cảnh báo, không tự huỷ đơn.
        </p>
      </header>

      {query.isLoading ? (
        <StateView title="Đang tải cài đặt đơn hàng" />
      ) : unsupported ? (
        <InlineAlert tone="warning">Máy chủ hiện chưa hỗ trợ cài đặt đơn hàng (cần cập nhật Server).</InlineAlert>
      ) : query.isError ? (
        <StateView
          title="Không tải được cài đặt đơn hàng"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : (
        <>
          {!isAdmin ? (
            <InlineAlert tone="warning">Chỉ quản trị viên được thay đổi cài đặt đơn hàng.</InlineAlert>
          ) : null}
          <div className="settings-form-grid">
            <label className="ds-field">
              <span className="ds-field__label">Cảnh báo vàng sau (phút)</span>
              <input
                className="ds-input"
                type="number"
                min={0}
                max={ORDER_QUEUE_MAX_MINUTES}
                step={1}
                value={warn}
                disabled={!isAdmin}
                onChange={(event) => setWarn(Number(event.target.value))}
              />
              <small>0 = tắt</small>
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Cảnh báo đỏ sau (phút)</span>
              <input
                className="ds-input"
                type="number"
                min={0}
                max={ORDER_QUEUE_MAX_MINUTES}
                step={1}
                value={danger}
                disabled={!isAdmin}
                onChange={(event) => setDanger(Number(event.target.value))}
              />
              <small>0 = tắt</small>
            </label>
          </div>

          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

          {isAdmin ? (
            <footer>
              <Button type="submit" variant="primary" loading={mutation.isPending}>
                Lưu cài đặt hàng đơn chờ
              </Button>
            </footer>
          ) : null}
        </>
      )}
    </form>
  )
}
