import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClientDisplaySettings, updateClientDisplaySettings } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'

const QUERY_KEY = ['settings', 'client-display'] as const

/**
 * Cài đặt → Máy trạm → "Hiển thị trên máy trạm": ẩn/hiện đơn giá và thời gian còn lại ở màn hình khách.
 * Form riêng (PUT /settings/client-display, chỉ ADMIN) nên KHÔNG lồng trong form máy trạm.
 */
export function ClientDisplaySection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getClientDisplaySettings, retry: false })
  const [showPrice, setShowPrice] = useState(true)
  const [showRemainTime, setShowRemainTime] = useState(true)

  // Form là bản nháp cục bộ nên cần đồng bộ theo dữ liệu server khi tải/lưu xong.
  useEffect(() => {
    if (!query.data) return
    setShowPrice(query.data.showPrice)
    setShowRemainTime(query.data.showRemainTime)
  }, [query.data])

  const mutation = useMutation({
    mutationFn: updateClientDisplaySettings,
    onSuccess: () => {
      pushToast('Đã lưu hiển thị trên máy trạm.', 'success')
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err: Error) => pushToast(err.message, 'error'),
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate({ showPrice, showRemainTime })
  }

  return (
    <form id="setting-client-display" className="settings-section" onSubmit={save}>
      <header>
        <h2>Hiển thị trên máy trạm</h2>
        <p>
          Chọn thông tin khách nhìn thấy trên màn hình máy trạm. Thay đổi áp dụng cho phiên đăng nhập mới; khách đang
          dùng máy giữ cách hiển thị cũ cho đến khi đăng nhập lại.
        </p>
      </header>
      {!isAdmin ? <InlineAlert tone="warning">Chỉ quản trị viên được đổi cách hiển thị trên máy trạm.</InlineAlert> : null}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !query.data ? (
        <StateView
          title="Không tải được cấu hình"
          description={query.error ? (query.error as Error).message : 'Máy chủ chưa hỗ trợ cài đặt này (cần cập nhật Server).'}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : (
        <>
          {query.data.fn1 ? null : (
            <InlineAlert tone="info">
              License chưa bật FN1: máy trạm luôn hiện đủ thông tin, cấu hình lưu được nhưng chưa có hiệu lực.
            </InlineAlert>
          )}
          <div className="settings-toggle-list">
            <Switch
              checked={showPrice}
              onCheckedChange={setShowPrice}
              disabled={!isAdmin}
              label="Hiện đơn giá"
              description="Giá tiền một giờ của nhóm máy khách đang ngồi. Tắt = để trống ô đơn giá."
            />
            <Switch
              checked={showRemainTime}
              onCheckedChange={setShowRemainTime}
              disabled={!isAdmin}
              label="Hiện thời gian còn lại"
              description="Thời gian còn lại theo số dư của khách."
            />
          </div>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin} loading={mutation.isPending}>
              Lưu hiển thị máy trạm
            </Button>
          </footer>
        </>
      )}
    </form>
  )
}
