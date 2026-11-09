import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHAT_QUERY_KEY,
  getChatSettings,
  isChatUnavailable,
  updateChatSettings,
  type ChatSettings,
} from '../../api/chat'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  CHAT_RETENTION_DEFAULT_DAYS,
  CHAT_RETENTION_MAX_DAYS,
  CHAT_RETENTION_MIN_DAYS,
  describeChatSettingsError,
  validateChatRetention,
} from './chatModel'

const SETTINGS_QUERY_KEY = ['settings', 'chat'] as const

/**
 * Settings → "Kênh chat Messenger": bật/tắt, số ngày giữ lịch sử, thư mục lưu.
 * Đây là NƠI DUY NHẤT bật kênh v2 (MFC không có công tắc — DESIGN_CHAT_MESSENGER 2.1). Chỉ quản trị viên
 * (server từ chối người khác), Server.exe bản cũ chưa có route ⇒ báo "chưa hỗ trợ" thay vì lỗi trắng.
 */
export function ChatSettingsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getChatSettings,
    enabled: isAdmin,
    retry: false,
  })

  const [enabled, setEnabled] = useState(false)
  const [autoPurge, setAutoPurge] = useState(true)
  const [days, setDays] = useState(CHAT_RETENTION_DEFAULT_DAYS)
  const [storagePath, setStoragePath] = useState('')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')

  const applyServer = (data: ChatSettings) => {
    setEnabled(data.enabled)
    setAutoPurge(data.retentionDays > 0)
    setDays(data.retentionDays > 0 ? data.retentionDays : CHAT_RETENTION_DEFAULT_DAYS)
    setStoragePath(data.storagePath)
  }

  // Đồng bộ form theo dữ liệu server khi tải/lưu xong. (Form là bản nháp cục bộ nên cần effect, không dẫn xuất được.)
  useEffect(() => {
    if (query.data) applyServer(query.data)
  }, [query.data])

  const mutation = useMutation({
    mutationFn: updateChatSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data)
      applyServer(data)
      setError('')
      setWarning(
        data.warning === 'old_data_not_moved'
          ? 'Đã đổi thư mục lưu. Lịch sử chat cũ KHÔNG được chuyển sang thư mục mới (vẫn nằm ở thư mục cũ).'
          : '',
      )
      pushToast('Đã lưu thiết lập kênh chat Messenger.', 'success')
      // Bật/tắt cờ đổi việc nút chat có hiện ở topbar hay không.
      void queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY })
    },
    onError: (err: Error) => {
      setWarning('')
      setError(describeChatSettingsError(err.message))
    },
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    const invalid = validateChatRetention(autoPurge, days)
    setError(invalid ?? '')
    if (invalid) return
    mutation.mutate({
      enabled,
      retentionDays: autoPurge ? days : 0,
      storagePath: storagePath.trim(),
    })
  }

  const unsupported = query.isError && isChatUnavailable(query.error) && (query.error as Error).message !== 'chat_v2_disabled'

  return (
    <form className="settings-section" onSubmit={save}>
      <header>
        <h2>Kênh chat Messenger</h2>
        <p>
          Chat giữa thu ngân và khách có biểu tượng, xuống dòng, lưu lịch sử theo tài khoản. Tắt = dùng kênh chat cũ
          như trước, không ghi thêm gì.
        </p>
      </header>

      {!isAdmin ? (
        <InlineAlert tone="warning">Chỉ quản trị viên được thay đổi thiết lập kênh chat.</InlineAlert>
      ) : query.isLoading ? (
        <StateView title="Đang tải thiết lập chat" />
      ) : unsupported ? (
        <InlineAlert tone="warning">Máy chủ hiện chưa hỗ trợ kênh chat Messenger (cần cập nhật Server).</InlineAlert>
      ) : query.isError ? (
        <StateView
          title="Không tải được thiết lập chat"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : (
        <>
          <div className="settings-toggle-list">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              label="Bật kênh chat Messenger"
              description="Chỉ máy trạm có phiên bản mới + bật hub mới dùng được; máy khác vẫn chat kênh cũ."
            />
            <Switch
              checked={autoPurge}
              onCheckedChange={setAutoPurge}
              label="Tự xoá lịch sử cũ"
              description="Tắt = giữ lịch sử mãi (tốn dung lượng đĩa)."
            />
          </div>

          <div className="settings-form-grid">
            <label className="ds-field">
              <span className="ds-field__label">Giữ lịch sử (ngày)</span>
              <input
                className="ds-input"
                type="number"
                min={CHAT_RETENTION_MIN_DAYS}
                max={CHAT_RETENTION_MAX_DAYS}
                step={1}
                value={days}
                disabled={!autoPurge}
                onChange={(event) => setDays(Number(event.target.value))}
              />
              <small>Từ {CHAT_RETENTION_MIN_DAYS} đến {CHAT_RETENTION_MAX_DAYS} ngày; tính cả hôm nay.</small>
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Thư mục lưu</span>
              <input
                className="ds-input"
                type="text"
                value={storagePath}
                placeholder={query.data?.effectivePath || 'Mặc định: thư mục chat_v2 cạnh Server'}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setStoragePath(event.target.value)}
              />
              <small>
                Để trống = {query.data?.effectivePath || 'thư mục mặc định'}. Chỉ ổ cục bộ của máy chủ. Đổi thư mục
                không chuyển lịch sử cũ.
              </small>
            </label>
          </div>

          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          {warning ? <InlineAlert tone="warning">{warning}</InlineAlert> : null}

          <footer>
            <Button type="submit" variant="primary" loading={mutation.isPending}>
              Lưu thiết lập chat
            </Button>
          </footer>
        </>
      )}
    </form>
  )
}
