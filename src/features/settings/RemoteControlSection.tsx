import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRemoteControl, updateRemoteControl, type RemoteControlUpdate } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'
import { OpsErrorState } from './SettingsOpsKit'

const QUERY_KEY = ['settings', 'remote'] as const

type Draft = { wsServer?: boolean; wsVnc?: boolean }

/**
 * Cài đặt → Bảo mật và lưu trữ → "Điều khiển từ xa" (GET|PUT /settings/remote, PUT chỉ ADMIN).
 * `wsVnc` chỉ có nghĩa khi `wsServer` bật (máy chủ từ chối ngược lại) ⇒ tắt `wsServer` luôn gửi kèm `wsVnc: false`.
 * Máy chủ chỉ kiểm cờ lúc bắt tay kết nối, nên tắt chỉ chặn kết nối MỚI; tab đang mở giữ kết nối cũ tới khi tải lại.
 */
export function RemoteControlSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getRemoteControl, retry: false })
  const [draft, setDraft] = useState<Draft>({})
  const [confirmLines, setConfirmLines] = useState<string[] | null>(null)

  const data = query.data
  const wsServer = draft.wsServer ?? data?.wsServer ?? false
  // wsServer tắt ⇒ wsVnc luôn hiển thị tắt (không giữ trạng thái nửa vời).
  const wsVnc = wsServer ? (draft.wsVnc ?? data?.wsVnc ?? false) : false

  const patch: RemoteControlUpdate = {}
  if (data) {
    if (wsServer !== data.wsServer) patch.wsServer = wsServer
    if (!wsServer) {
      // Luật máy chủ: wsVnc không được bật khi wsServer tắt ⇒ tắt wsServer phải kèm wsVnc:false.
      if (patch.wsServer === false) patch.wsVnc = false
    } else if (wsVnc !== data.wsVnc) {
      patch.wsVnc = wsVnc
    }
  }
  const dirty = Object.keys(patch).length > 0

  const mutation = useMutation({
    mutationFn: updateRemoteControl,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft({})
      setConfirmLines(null)
      pushToast('Đã lưu cài đặt điều khiển từ xa.', 'success')
    },
    onError: (err: Error) => {
      setConfirmLines(null)
      pushToast(err.message, 'error')
    },
  })

  const requestSave = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    if (patch.wsVnc === true) {
      setConfirmLines([
        'Nhân viên có quyền “Điều khiển từ xa” sẽ xem và điều khiển được màn hình máy trạm ngay trong trình duyệt.',
        'Mật khẩu VNC của máy trạm là giá trị cố định và được gửi xuống trình duyệt cùng vé truy cập.',
        'Chỉ bật khi web chỉ được truy cập trong mạng nội bộ của phòng máy; không mở ra internet.',
      ])
      return
    }
    mutation.mutate(patch)
  }

  const disabled = !isAdmin || mutation.isPending
  const vncLocked = !wsServer

  return (
    <form id="setting-remote-control" className="settings-section settings-section--compact" onSubmit={requestSave}>
      <header>
        <h2>Điều khiển từ xa</h2>
        <p>Kết nối thời gian thực của trang web và xem, điều khiển màn hình máy trạm từ trình duyệt.</p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi cài đặt điều khiển từ xa.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="settings-toggle-list">
            <Switch
              checked={wsServer}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, wsServer: checked }))}
              disabled={disabled}
              label="Máy chủ WebSocket"
              description="Cho trang web nhận sự kiện tức thì (kết nối /ws). Tắt = các trang web quay về tự làm mới theo chu kỳ. Tắt có hiệu lực với kết nối mới; tab đang mở giữ kết nối cũ tới khi tải lại trang."
            />
            <Switch
              checked={wsVnc}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, wsVnc: checked }))}
              disabled={disabled || vncLocked}
              className={vncLocked ? 'ops-switch-locked' : ''}
              label="Điều khiển màn hình máy trạm qua trình duyệt"
              description="Cho nhân viên có quyền “Điều khiển từ xa” xem và điều khiển màn hình máy trạm ngay trên web. Tính năng thử nghiệm. Tab đang mở chỉ nhận thay đổi sau khi tải lại trang."
            />
          </div>
          {vncLocked ? (
            <InlineAlert tone="info">
              Điều khiển màn hình qua trình duyệt cần bật “Máy chủ WebSocket” trước. Khi tắt máy chủ WebSocket, tùy chọn này
              tự tắt theo.
            </InlineAlert>
          ) : null}
          <InlineAlert tone="warning">
            Bảo mật: bật điều khiển màn hình nghĩa là người đăng nhập web có quyền “Điều khiển từ xa” thao tác được máy
            khách. Mật khẩu VNC của máy trạm là giá trị cố định và được gửi xuống trình duyệt cùng vé truy cập (dùng một
            lần, hiệu lực 30 giây). Chỉ dùng khi web chỉ truy cập trong mạng nội bộ; không mở ra internet. Hãy kiểm tra
            quyền “Điều khiển từ xa” của từng nhân viên.
          </InlineAlert>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending && confirmLines === null}>
              Lưu cài đặt từ xa
            </Button>
          </footer>
        </>
      )}
      <SettingsConfirmDialog
        open={confirmLines !== null}
        title="Bật điều khiển màn hình máy trạm qua trình duyệt?"
        consequences={confirmLines ?? []}
        confirmLabel="Hiểu rủi ro, bật và lưu"
        danger
        pending={mutation.isPending}
        onCancel={() => setConfirmLines(null)}
        onConfirm={() => mutation.mutate(patch)}
      />
    </form>
  )
}
