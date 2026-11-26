import { useState, type FormEvent } from 'react'
import { ArrowCounterClockwise } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getNotifyServerSettings, updateNotifyServerSettings, type NotifyServerUpdate } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { OpsErrorState } from './SettingsOpsKit'
import {
  CHARGE_KEYWORD_MAX_COUNT,
  CHARGE_KEYWORD_MAX_LENGTH,
  normalizeChargeKeywords,
  validateChargeKeywords,
} from './settingsOpsModel'

const QUERY_KEY = ['settings', 'notify'] as const

type Draft = { enabled?: boolean; keywords?: string }

/**
 * Khối ADMIN "Thông báo trên máy chủ" ở trang /notification-settings (GET|PUT /settings/notify, PUT chỉ ADMIN).
 * KHÁC với các tùy chọn chuông/âm báo bên trên (lưu riêng ở trình duyệt): đây là cờ của cả máy chủ, ảnh hưởng mọi
 * nhân viên và giao diện MFC.
 */
export function NotifyServerSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getNotifyServerSettings, retry: false })
  const [draft, setDraft] = useState<Draft>({})
  const [error, setError] = useState('')

  const data = query.data
  const enabled = draft.enabled ?? data?.enabled ?? true
  const keywords = draft.keywords ?? data?.chargeReqKeywords ?? ''

  const patch: NotifyServerUpdate = {}
  if (data) {
    if (enabled !== data.enabled) patch.enabled = enabled
    if (draft.keywords !== undefined && normalizeChargeKeywords(keywords) !== normalizeChargeKeywords(data.chargeReqKeywords)) {
      patch.chargeReqKeywords = normalizeChargeKeywords(keywords)
    }
  }
  const dirty = Object.keys(patch).length > 0

  const mutation = useMutation({
    mutationFn: updateNotifyServerSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft({})
      setError('')
      pushToast('Đã lưu thông báo trên máy chủ.', 'success')
    },
    onError: (err: Error) => {
      setError(err.message)
      pushToast(err.message, 'error')
    },
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    const problem = patch.chargeReqKeywords === undefined ? null : validateChargeKeywords(patch.chargeReqKeywords)
    setError(problem ?? '')
    if (problem) return
    mutation.mutate(patch)
  }

  const disabled = !isAdmin || mutation.isPending

  return (
    <form id="setting-notify-server" className="settings-section settings-section--compact" onSubmit={save}>
      <header>
        <h2>Thông báo trên máy chủ</h2>
        <p>
          Khác với các tùy chọn chuông và âm báo phía trên (chỉ áp dụng cho trình duyệt này), phần này là cài đặt của cả
          máy chủ: ảnh hưởng mọi nhân viên và giao diện phần mềm máy chủ.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi thông báo trên máy chủ.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <div className="settings-toggle-list">
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
              disabled={disabled}
              label="Bật thông báo trên máy chủ"
              description="Tắt = máy chủ không phát thông báo “khách xin nạp tiền” và không nhận thao tác xóa hay gửi thông báo từ web (các thao tác này bị từ chối)."
            />
          </div>
          <div className="ops-field">
            <label className="ds-field">
              <span className="ds-field__label">Từ khóa nhận biết tin xin nạp tiền</span>
              <span className="ops-field__row">
                <input
                  className="ds-input ops-input-wide"
                  type="text"
                  value={keywords}
                  disabled={disabled}
                  spellCheck={false}
                  placeholder={data.defaultChargeReqKeywords}
                  onChange={(event) => {
                    setError('')
                    setDraft((current) => ({ ...current, keywords: event.target.value }))
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  icon={<ArrowCounterClockwise size={18} weight="bold" />}
                  disabled={disabled || normalizeChargeKeywords(keywords) === normalizeChargeKeywords(data.defaultChargeReqKeywords)}
                  onClick={() => setDraft((current) => ({ ...current, keywords: data.defaultChargeReqKeywords }))}
                >
                  Khôi phục mặc định
                </Button>
              </span>
            </label>
            <p className="ops-hint">
              Tin nhắn của hội viên chứa một trong các từ này sẽ được báo là khách xin nạp tiền. Ngăn cách bằng dấu phẩy;
              tối đa {CHARGE_KEYWORD_MAX_COUNT} từ, mỗi từ không quá {CHARGE_KEYWORD_MAX_LENGTH} ký tự, tổng không quá
              255 ký tự. Để trống rồi lưu = dùng danh sách mặc định.
            </p>
            <p className="ops-hint">Mặc định: {data.defaultChargeReqKeywords}</p>
          </div>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending}>
              Lưu thông báo máy chủ
            </Button>
          </footer>
        </>
      )}
    </form>
  )
}
