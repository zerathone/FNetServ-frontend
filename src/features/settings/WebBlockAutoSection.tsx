import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getWebBlockAuto, updateWebBlockAuto } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { OpsErrorState } from './SettingsOpsKit'

const QUERY_KEY = ['settings', 'webblock-auto'] as const

/**
 * Cài đặt → Bảo mật và lưu trữ → "Tự cập nhật danh sách chặn web" (GET|PUT /settings/webblock-auto, PUT chỉ ADMIN).
 * Bật = mỗi giờ máy chủ tự tải danh sách chặn đã ký số từ máy chủ FNet và áp cho phòng máy.
 */
export function WebBlockAutoSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getWebBlockAuto, retry: false })
  const [draft, setDraft] = useState<boolean | undefined>(undefined)

  const saved = query.data?.autoUpdate
  const value = draft ?? saved ?? false
  const dirty = saved !== undefined && draft !== undefined && draft !== saved

  const mutation = useMutation({
    mutationFn: updateWebBlockAuto,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft(undefined)
      pushToast('Đã lưu cài đặt tự cập nhật danh sách chặn web.', 'success')
    },
    onError: (err: Error) => pushToast(err.message, 'error'),
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    mutation.mutate({ autoUpdate: value })
  }

  return (
    <form id="setting-webblock-auto" className="settings-section settings-section--compact" onSubmit={save}>
      <header>
        <h2>Tự cập nhật danh sách chặn web</h2>
        <p>
          Máy chủ có thể tự tải danh sách trang web cần chặn do FNet cung cấp, thay vì phải nhập hoặc cập nhật bằng tay.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi cài đặt này.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !query.data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="settings-toggle-list">
            <Switch
              checked={value}
              onCheckedChange={setDraft}
              disabled={!isAdmin || mutation.isPending}
              label="Tự tải danh sách chặn web mỗi giờ"
              description="Mỗi giờ máy chủ tải danh sách chặn đã được ký số từ máy chủ FNet (icafe.fnet.com.vn). Cần máy chủ kết nối được internet. Tắt = chỉ dùng danh sách bạn tự quản lý."
            />
          </div>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending}>
              Lưu cài đặt
            </Button>
          </footer>
        </>
      )}
    </form>
  )
}
