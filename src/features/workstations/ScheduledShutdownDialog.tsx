import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getShutdownAll, shutdownAllNow, updateShutdownAll } from '../../api/workstations'
import { Button, ConfirmAction, Dialog, InlineAlert, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  shutdownEpoch,
  toLocalDateTimeInput,
  toLocalTimeInput,
  validateShutdownSchedule,
  type ShutdownMode,
} from './phase2Model'
import './workstations.css'

type ScheduledShutdownDialogProps = {
  open: boolean
  canManage: boolean
  onClose: () => void
}

export function ScheduledShutdownDialog({ open, canManage, onClose }: ScheduledShutdownDialogProps) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ShutdownMode>('off')
  const [onceAt, setOnceAt] = useState('')
  const [dailyAt, setDailyAt] = useState('23:00')
  const [error, setError] = useState('')
  const [confirmNow, setConfirmNow] = useState(false)
  const query = useQuery({
    queryKey: ['workstations', 'shutdown-all'],
    queryFn: getShutdownAll,
    enabled: open,
  })

  useEffect(() => {
    if (!open || !query.data) return
    setMode(query.data.mode)
    setOnceAt(toLocalDateTimeInput(query.data.at))
    setDailyAt(toLocalTimeInput(query.data.at))
    setError('')
  }, [open, query.data])

  const scheduleMutation = useMutation({
    mutationFn: () => {
      const validationError = validateShutdownSchedule(mode, onceAt, dailyAt)
      if (validationError) throw new Error(validationError)
      return updateShutdownAll({ mode, at: shutdownEpoch(mode, onceAt, dailyAt) })
    },
    onSuccess: () => {
      pushToast(mode === 'off' ? 'Đã tắt lịch tắt toàn bộ máy.' : 'Đã lưu lịch tắt toàn bộ máy.', 'success')
      setError('')
      void queryClient.invalidateQueries({ queryKey: ['workstations', 'shutdown-all'] })
      onClose()
    },
    onError: (mutationError) => setError(mutationError.message),
  })
  const nowMutation = useMutation({
    mutationFn: shutdownAllNow,
    onSuccess: () => {
      pushToast('Đã gửi lệnh tắt tới toàn bộ máy trạm.', 'success')
      setConfirmNow(false)
      onClose()
    },
    onError: (mutationError) => pushToast(mutationError.message, 'error'),
  })

  const submit = () => {
    const validationError = validateShutdownSchedule(mode, onceAt, dailyAt)
    setError(validationError ?? '')
    if (!validationError) scheduleMutation.mutate()
  }

  return (
    <>
      <Dialog
        open={open}
        title="Lịch tắt toàn bộ máy trạm"
        description="Đặt lịch một lần, lặp hằng ngày hoặc tắt lịch đang có."
        size="md"
        onClose={scheduleMutation.isPending ? () => undefined : onClose}
        footer={
          <>
            <Button type="button" variant="danger" disabled={!canManage || scheduleMutation.isPending} onClick={() => setConfirmNow(true)}>Tắt tất cả ngay</Button>
            <Button type="button" variant="secondary" disabled={scheduleMutation.isPending} onClick={onClose}>Hủy</Button>
            <Button type="button" variant="primary" loading={scheduleMutation.isPending} disabled={!canManage || query.isLoading || query.isError} onClick={submit}>Lưu lịch</Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          {!canManage ? <InlineAlert tone="warning">Bạn cần quyền Tắt tất cả máy trạm (131) để lưu hoặc thực hiện ngay.</InlineAlert> : null}
          {query.isLoading ? <StateView title="Đang tải lịch…" /> : null}
          {query.isError ? <StateView title="Không tải được lịch" description={(query.error as Error).message} action={<Button onClick={() => query.refetch()}>Thử lại</Button>} /> : null}
          {query.data ? (
            <>
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
              <fieldset className="ws-choice-group">
                <legend>Kiểu lịch</legend>
                <label><input type="radio" name="shutdown-mode" checked={mode === 'off'} onChange={() => setMode('off')} /><span><strong>Tắt lịch</strong><small>Không tự động tắt toàn bộ máy.</small></span></label>
                <label><input type="radio" name="shutdown-mode" checked={mode === 'once'} onChange={() => setMode('once')} /><span><strong>Một lần</strong><small>Tắt vào một ngày giờ cụ thể.</small></span></label>
                <label><input type="radio" name="shutdown-mode" checked={mode === 'daily'} onChange={() => setMode('daily')} /><span><strong>Hằng ngày</strong><small>Lặp lại vào cùng một giờ mỗi ngày.</small></span></label>
              </fieldset>
              {mode === 'once' ? (
                <label className="ds-field"><span className="ds-field__label">Ngày giờ tắt máy</span><input className="ds-input" type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} /></label>
              ) : null}
              {mode === 'daily' ? (
                <label className="ds-field"><span className="ds-field__label">Giờ tắt máy hằng ngày</span><input className="ds-input" type="time" value={dailyAt} onChange={(event) => setDailyAt(event.target.value)} /></label>
              ) : null}
              <InlineAlert tone="info">API Web hỗ trợ lịch giờ/ngày. Chế độ đếm ngược riêng của ứng dụng MFC không được REST hóa.</InlineAlert>
            </>
          ) : null}
        </div>
      </Dialog>

      <ConfirmAction
        open={confirmNow}
        title="Tắt toàn bộ máy ngay?"
        description="Lệnh được gửi tới tất cả máy đang hoạt động và không thể thu hồi."
        confirmLabel="Tắt toàn bộ máy"
        danger
        pending={nowMutation.isPending}
        onCancel={() => setConfirmNow(false)}
        onConfirm={() => nowMutation.mutate()}
      >
        <InlineAlert tone="danger">Các phiên đang sử dụng có thể bị gián đoạn. Hãy xác nhận rằng khách đã được thông báo.</InlineAlert>
      </ConfirmAction>
    </>
  )
}
