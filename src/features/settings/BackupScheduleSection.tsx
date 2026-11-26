import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBackupSchedule,
  updateBackupSchedule,
  type BackupScheduleType,
  type BackupScheduleUpdate,
} from '../../api/settings'
import { Button, InlineAlert, Segmented, Select, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { OpsErrorState } from './SettingsOpsKit'
import {
  BACKUP_TYPE_OPTIONS,
  hourlyTime,
  minuteOfTime,
  validateBackupDraft,
  WEEKDAY_LABELS,
  type BackupDraft,
} from './settingsOpsModel'

const QUERY_KEY = ['settings', 'backup-schedule'] as const

/** Bản nháp: chỉ chứa ô người dùng đã đụng tới; ô còn lại lấy giá trị đang lưu trên máy chủ. */
type Draft = Partial<BackupDraft>

/**
 * Cài đặt → Bảo mật và lưu trữ → "Lịch sao lưu dữ liệu" (GET|PUT /settings/backup-schedule, PUT chỉ ADMIN).
 * - Mỗi giờ: máy chủ chỉ so PHÚT nên chỉ hỏi phút và gửi "00:MM".
 * - Mỗi tuần: chọn thứ thật Chủ nhật..Thứ bảy = 0..6 (máy chủ tự đổi sang chỉ số lưu của MFC).
 * - Tắt lịch = type 0, KHÔNG xoá thư mục lưu.
 * - Thư mục dữ liệu MySQL chỉ đọc (máy chủ dò từ MySQL).
 */
export function BackupScheduleSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getBackupSchedule, retry: false })
  const [draft, setDraft] = useState<Draft>({})
  const [error, setError] = useState('')
  const ids = useId()

  const data = query.data
  const current: BackupDraft = {
    type: draft.type ?? data?.type ?? 0,
    time: draft.time ?? data?.time ?? '00:00',
    day: draft.day !== undefined ? draft.day : (data?.day ?? null),
    compress: draft.compress ?? data?.compress ?? false,
    backupPath: draft.backupPath ?? data?.backupPath ?? '',
  }

  const dirty =
    data !== undefined &&
    (current.type !== data.type ||
      (current.type !== 0 &&
        (current.time !== data.time ||
          current.day !== data.day ||
          current.compress !== data.compress ||
          current.backupPath.trim() !== data.backupPath)))

  const set = (patch: Draft) => {
    setError('')
    setDraft((previous) => ({ ...previous, ...patch }))
  }

  const mutation = useMutation({
    mutationFn: updateBackupSchedule,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft({})
      setError('')
      pushToast(result.type === 0 ? 'Đã tắt lịch sao lưu.' : 'Đã lưu lịch sao lưu dữ liệu.', 'success')
    },
    onError: (err: Error) => {
      setError(err.message)
      pushToast(err.message, 'error')
    },
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    const problem = validateBackupDraft(current)
    setError(problem ?? '')
    if (problem) return

    // Tắt lịch: chỉ gửi type 0 để máy chủ giữ nguyên thư mục lưu (MFC xoá thư mục khi tắt, web cố ý khác).
    if (current.type === 0) {
      mutation.mutate({ type: 0 })
      return
    }
    const payload: BackupScheduleUpdate = {
      type: current.type,
      time: current.type === 1 ? hourlyTime(minuteOfTime(current.time)) : current.time,
      compress: current.compress,
      backupPath: current.backupPath.trim(),
    }
    if (current.type === 3 && current.day !== null) payload.day = current.day
    mutation.mutate(payload)
  }

  const disabled = !isAdmin || mutation.isPending
  const off = current.type === 0
  const typeId = `${ids}-type`
  const dayId = `${ids}-day`

  return (
    <form id="setting-backup-schedule" className="settings-section" onSubmit={save}>
      <header>
        <h2>Lịch sao lưu dữ liệu</h2>
        <p>
          Máy chủ tự sao chép dữ liệu MySQL sang một thư mục theo lịch. Bản sao nằm ngay trên máy chủ; hãy chọn ổ đĩa khác
          ổ đang chạy phần mềm để an toàn hơn.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi lịch sao lưu.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <InlineAlert tone="info">
            Bản sao chỉ chép đầy đủ khi cơ sở dữ liệu dùng định dạng MyISAM. Nếu về sau chuyển sang MySQL 8 với InnoDB,
            bản sao theo cách này sẽ không đầy đủ.
          </InlineAlert>
          {data.type === 3 && data.day === null ? (
            <InlineAlert tone="warning">
              Thứ trong tuần đang lưu không hợp lệ nên lịch hàng tuần chưa chạy. Hãy chọn lại thứ bên dưới rồi lưu.
            </InlineAlert>
          ) : null}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

          <div className="ops-field">
            <span className="ds-field__label" id={typeId}>
              Kiểu lịch
            </span>
            <Segmented
              ariaLabel="Kiểu lịch sao lưu"
              value={`${current.type}`}
              disabled={disabled}
              options={BACKUP_TYPE_OPTIONS}
              onChange={(value) => set({ type: Number(value) as BackupScheduleType })}
            />
            {off ? (
              <p className="ops-hint">
                Lịch đang tắt. Tắt lịch không xóa thư mục lưu đã cấu hình; chọn một kiểu lịch để chỉnh giờ và thư mục.
              </p>
            ) : null}
          </div>

          {current.type === 1 ? (
            <div className="ops-field">
              <label className="ds-field settings-short-field">
                <span className="ds-field__label">Phút trong mỗi giờ</span>
                <span className="ops-field__row">
                  <input
                    className="ds-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    step={1}
                    value={minuteOfTime(current.time)}
                    disabled={disabled}
                    onChange={(event) => set({ time: hourlyTime(Number(event.target.value)) })}
                  />
                  <span className="ops-field__unit">phút (0 đến 59)</span>
                </span>
              </label>
              <p className="ops-hint">Sao lưu vào phút này của mỗi giờ, ví dụ 15 là 01:15, 02:15, 03:15...</p>
            </div>
          ) : null}

          {current.type === 3 ? (
            <div className="ops-field">
              <span className="ds-field__label" id={dayId}>
                Thứ trong tuần
              </span>
              <Select
                aria-labelledby={dayId}
                value={current.day === null ? '' : String(current.day)}
                disabled={disabled}
                onChange={(event: { target: { value: string } }) => {
                  const value = event.target.value
                  set({ day: value === '' ? null : Number(value) })
                }}
              >
                <option value="">Chọn thứ…</option>
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {current.type === 2 || current.type === 3 ? (
            <div className="ops-field">
              <label className="ds-field settings-short-field">
                <span className="ds-field__label">Giờ sao lưu</span>
                <input
                  className="ds-input"
                  type="time"
                  value={current.time}
                  disabled={disabled}
                  onChange={(event) => set({ time: event.target.value })}
                />
              </label>
              <p className="ops-hint">Giờ theo đồng hồ của máy chủ.</p>
            </div>
          ) : null}

          <div className="ops-field">
            <label className="ds-field">
              <span className="ds-field__label">Thư mục lưu bản sao</span>
              <input
                className="ds-input ops-input-wide"
                type="text"
                value={current.backupPath}
                maxLength={250}
                placeholder="Ví dụ D:\SaoLuuDuLieu"
                spellCheck={false}
                disabled={disabled || off}
                onChange={(event) => set({ backupPath: event.target.value })}
              />
            </label>
            <p className="ops-hint">
              Đường dẫn tuyệt đối trên ổ đĩa của máy chủ và thư mục phải tồn tại sẵn. Không dùng thư mục gốc ổ đĩa, thư mục
              Windows, thư mục chạy phần mềm máy chủ hay thư mục dữ liệu MySQL, và không dùng đường dẫn mạng.
            </p>
          </div>

          <div className="settings-toggle-list">
            <Switch
              checked={current.compress}
              onCheckedChange={(checked) => set({ compress: checked })}
              disabled={disabled || off}
              label="Nén bản sao"
              description="Nén mỗi bản sao để tiết kiệm dung lượng ổ đĩa, đổi lại tốn thêm thời gian khi sao lưu."
            />
          </div>

          <div className="ops-field">
            <span className="ds-field__label">Thư mục dữ liệu MySQL (chỉ đọc)</span>
            <div className="ops-readonly">
              {data.mysqlDataDir ? (
                <code>{data.mysqlDataDir}</code>
              ) : (
                <span>Không dò được thư mục dữ liệu MySQL từ máy chủ.</span>
              )}
            </div>
            <p className="ops-hint">Đây là nơi MySQL đang lưu dữ liệu, máy chủ tự dò và không chỉnh được ở đây.</p>
          </div>

          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending}>
              Lưu lịch sao lưu
            </Button>
          </footer>
        </>
      )}
    </form>
  )
}
