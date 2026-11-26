import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getClientRuntime, updateClientRuntime, type ClientRuntimeUpdate } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'
import { OpsErrorState } from './SettingsOpsKit'
import {
  CLIENT_APPLY_NOTE,
  HUB_WEB_CLIENT_LOCKED,
  isPausedResetInDomain,
  PAUSED_RESET_MAX_MINUTES,
  PAUSED_RESET_MIN_MINUTES,
  validatePausedResetMinutes,
} from './settingsOpsModel'

const QUERY_KEY = ['settings', 'client-runtime'] as const

type Draft = { pausedReset?: string; hwMonitor?: boolean; hubWeb?: boolean; ipStrict?: boolean }

/**
 * Cài đặt → Máy trạm → "Vận hành máy trạm" (GET|PUT /settings/client-runtime, PUT chỉ ADMIN). Bốn cờ máy trạm nhận qua
 * cấu hình máy chủ — không đẩy realtime nên mỗi điều khiển ghi rõ "áp dụng khi máy trạm nhận lại cấu hình".
 */
export function ClientRuntimeSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getClientRuntime, retry: false })
  const [draft, setDraft] = useState<Draft>({})
  const [error, setError] = useState('')
  const [confirmLines, setConfirmLines] = useState<string[] | null>(null)

  const data = query.data
  const pausedText = draft.pausedReset ?? (data ? String(data.pausedResetMinutes) : '')
  const pausedParsed = pausedText.trim() === '' ? Number.NaN : Number(pausedText)
  const hwMonitor = draft.hwMonitor ?? data?.hwMonitor ?? true
  const hubWeb = draft.hubWeb ?? data?.hubWeb ?? false
  const ipStrict = draft.ipStrict ?? data?.ipStrict ?? false

  // Chỉ gửi ô đã đổi: giá trị đang lưu ngoài miền (1, 2, trên 60) giữ nguyên nếu không ai sửa, không bị máy chủ từ chối.
  const patch: ClientRuntimeUpdate = {}
  if (data) {
    if (draft.pausedReset !== undefined && pausedParsed !== data.pausedResetMinutes) {
      patch.pausedResetMinutes = pausedParsed
    }
    if (hwMonitor !== data.hwMonitor) patch.hwMonitor = hwMonitor
    if (hubWeb !== data.hubWeb) patch.hubWeb = hubWeb
    if (ipStrict !== data.ipStrict) patch.ipStrict = ipStrict
  }
  const dirty = Object.keys(patch).length > 0

  const mutation = useMutation({
    mutationFn: updateClientRuntime,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft({})
      setError('')
      setConfirmLines(null)
      pushToast('Đã lưu cấu hình vận hành máy trạm. Máy trạm áp dụng khi nhận lại cấu hình.', 'success')
    },
    onError: (err: Error) => {
      setConfirmLines(null)
      setError(err.message)
      pushToast(err.message, 'error')
    },
  })

  const requestSave = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    if (patch.pausedResetMinutes !== undefined) {
      const problem = validatePausedResetMinutes(patch.pausedResetMinutes)
      setError(problem ?? '')
      if (problem) return
    } else {
      setError('')
    }
    const lines: string[] = []
    if (patch.pausedResetMinutes === 0) {
      lines.push('Máy trạm bị treo sẽ không còn tự khởi động lại và không còn bị tự tắt khi lặp lại: mất cơ chế chống gian lận bằng cách treo máy.')
    }
    if (patch.ipStrict === true) {
      lines.push('Máy chủ sẽ từ chối yêu cầu từ máy trạm khi địa chỉ IP nguồn khác địa chỉ IP của phiên. Máy trạm dùng NAT hoặc có nhiều card mạng có thể bị chặn nhầm.')
      lines.push('Nên xem nhật ký cảnh báo “client_ip_mismatch” vài tuần trước khi bật.')
    }
    if (lines.length === 0) {
      mutation.mutate(patch)
      return
    }
    lines.push('Máy trạm áp dụng khi nhận lại cấu hình, không có đẩy tức thì.')
    setConfirmLines(lines)
  }

  const disabled = !isAdmin || mutation.isPending

  return (
    <form id="setting-client-runtime" className="settings-section" onSubmit={requestSave}>
      <header>
        <h2>Vận hành máy trạm</h2>
        <p>
          Các cờ điều khiển cách máy trạm tự bảo vệ và kết nối. Máy chủ lưu ngay, máy trạm chỉ áp dụng khi nhận lại cấu
          hình.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi cấu hình vận hành máy trạm.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {isPausedResetInDomain(data.pausedResetMinutes) ? null : (
            <InlineAlert tone="warning">
              Số phút tự khởi động lại đang lưu là {data.pausedResetMinutes}, ngoài khoảng cho phép (0 hoặc{' '}
              {PAUSED_RESET_MIN_MINUTES} đến {PAUSED_RESET_MAX_MINUTES}). Giá trị này vẫn đang được áp dụng; máy trạm tự
              nâng 1 lên 2 phút. Hãy nhập lại giá trị hợp lệ nếu cần đổi.
            </InlineAlert>
          )}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

          <div className="ops-field" id="setting-client-runtime-paused-reset">
            <label className="ds-field settings-short-field">
              <span className="ds-field__label">Tự khởi động lại máy trạm bị treo sau</span>
              <span className="ops-field__row">
                <input
                  className="ds-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={PAUSED_RESET_MAX_MINUTES}
                  step={1}
                  value={pausedText}
                  disabled={disabled}
                  onChange={(event) => setDraft((current) => ({ ...current, pausedReset: event.target.value }))}
                />
                <span className="ops-field__unit">phút (0 = tắt, hoặc {PAUSED_RESET_MIN_MINUTES} đến {PAUSED_RESET_MAX_MINUTES})</span>
              </span>
            </label>
            <p className="ops-hint">
              Máy trạm treo quá số phút này sẽ tự khởi động lại; lặp lại 3 lần trong 30 phút thì máy tự tắt. Đặt 0 là
              mất cơ chế chống gian lận bằng cách treo máy. Mặc định 3 phút.
            </p>
            <p className="ops-hint ops-hint--apply">{CLIENT_APPLY_NOTE}</p>
          </div>

          <div className="settings-toggle-list">
            <Switch
              checked={hwMonitor}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, hwMonitor: checked }))}
              disabled={disabled}
              label="Giám sát phần cứng máy trạm"
              description={
                <>
                  Máy trạm gửi nhiệt độ, CPU, bộ nhớ về trang Theo dõi hoạt động. Tắt có hiệu lực sau khoảng 3,5 phút kể
                  từ khi máy trạm nhận cấu hình; bật lại cần khởi động lại phần mềm máy trạm. Ngoài ra, bật ở đây chưa
                  chắc chạy: máy trạm còn cần cờ cục bộ trên chính máy đó (khóa cấu hình REG_HWM = 1).
                  <br />
                  {CLIENT_APPLY_NOTE}
                </>
              }
            />
            <Switch
              checked={hubWeb}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, hubWeb: checked }))}
              disabled={disabled}
              label="Hub web trên máy trạm"
              description={
                <>
                  Cho phép máy trạm mở trang hub web của phòng máy.
                  <br />
                  {CLIENT_APPLY_NOTE}
                </>
              }
            />
            <Switch
              checked={ipStrict}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, ipStrict: checked }))}
              disabled={disabled}
              label="Kiểm tra nghiêm ngặt địa chỉ IP máy trạm"
              description={
                <>
                  Bật = máy chủ từ chối yêu cầu từ máy trạm khi IP nguồn lệch IP của phiên. Tắt = chỉ ghi cảnh báo
                  “client_ip_mismatch” vào nhật ký. Máy trạm dùng NAT hoặc nhiều card mạng có thể bị chặn nhầm; nên xem
                  nhật ký vài tuần trước khi bật. Máy chủ kiểm tra ngay từ khi lưu.
                  <br />
                  {CLIENT_APPLY_NOTE}
                </>
              }
            />
          </div>
          {HUB_WEB_CLIENT_LOCKED ? (
            <InlineAlert tone="info">
              “Hub web trên máy trạm”: bản máy trạm hiện tại khóa cứng tính năng này nên bật cờ chưa có hiệu lực. Cấu hình
              vẫn lưu được và sẽ dùng khi bản máy trạm mới mở khóa.
            </InlineAlert>
          ) : null}
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending && confirmLines === null}>
              Lưu cấu hình máy trạm
            </Button>
          </footer>
        </>
      )}
      <SettingsConfirmDialog
        open={confirmLines !== null}
        title="Xác nhận đổi cấu hình vận hành máy trạm?"
        consequences={confirmLines ?? []}
        danger
        pending={mutation.isPending}
        onCancel={() => setConfirmLines(null)}
        onConfirm={() => mutation.mutate(patch)}
      />
    </form>
  )
}
