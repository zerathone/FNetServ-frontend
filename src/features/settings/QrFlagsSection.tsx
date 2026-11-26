import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getQrFlags, updateQrFlags, type QrFlagsUpdate } from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'
import { OpsErrorState } from './SettingsOpsKit'

const QUERY_KEY = ['settings', 'qr-flags'] as const

type Draft = { pendingBook?: boolean; manualConfirm?: boolean }

/**
 * Cài đặt → Phương thức thanh toán → "Thanh toán QR" (GET|PUT /settings/qr-flags, PUT chỉ ADMIN). Hai cờ máy chủ đọc
 * tươi từ cơ sở dữ liệu, hiệu lực trong 30 giây. Xác nhận thủ công chỉ chạy khi ghi sổ đơn QR đang bật.
 */
export function QrFlagsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getQrFlags, retry: false })
  const [draft, setDraft] = useState<Draft>({})
  const [confirmLines, setConfirmLines] = useState<string[] | null>(null)

  const data = query.data
  const pendingBook = draft.pendingBook ?? data?.pendingBook ?? true
  const manualConfirm = draft.manualConfirm ?? data?.manualConfirm ?? true
  // Chỉ gửi ô đã đổi so với giá trị đang lưu (PUT từng phần).
  const patch: QrFlagsUpdate = {}
  if (data && pendingBook !== data.pendingBook) patch.pendingBook = pendingBook
  if (data && manualConfirm !== data.manualConfirm) patch.manualConfirm = manualConfirm
  const dirty = Object.keys(patch).length > 0

  const mutation = useMutation({
    mutationFn: updateQrFlags,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft({})
      setConfirmLines(null)
      pushToast('Đã lưu cờ thanh toán QR. Có hiệu lực trong 30 giây.', 'success')
    },
    onError: (err: Error) => {
      setConfirmLines(null)
      pushToast(err.message, 'error')
    },
  })

  const requestSave = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    const lines: string[] = []
    if (patch.pendingBook === false) {
      lines.push('Đơn thanh toán QR mới sẽ không còn được ghi sổ chờ xác nhận.')
      lines.push('Nút “Đã nhận được tiền” (xác nhận thủ công) cũng ngừng hoạt động vì phụ thuộc vào ghi sổ đơn QR.')
    }
    if (patch.manualConfirm === false) {
      lines.push('Thu ngân không còn nút “Đã nhận được tiền”: nếu khách đã chuyển khoản nhưng hệ thống chưa nhận được thông báo, không thể tự xác nhận.')
    }
    if (lines.length === 0) {
      mutation.mutate(patch)
      return
    }
    lines.push('Có hiệu lực trong khoảng 30 giây sau khi lưu.')
    setConfirmLines(lines)
  }

  const manualLocked = !pendingBook
  const disabled = !isAdmin || mutation.isPending

  return (
    <form id="setting-qr-flags" className="settings-section settings-section--compact" onSubmit={requestSave}>
      <header>
        <h2>Thanh toán QR: ghi sổ và xác nhận thủ công</h2>
        <p>Điều khiển cách máy chủ xử lý đơn thanh toán bằng mã QR. Thay đổi có hiệu lực trong 30 giây.</p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi cài đặt thanh toán QR.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="settings-toggle-list">
            <Switch
              checked={pendingBook}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, pendingBook: checked }))}
              disabled={disabled}
              label="Ghi sổ đơn thanh toán QR"
              description="Ghi lại mỗi đơn QR đang chờ khách chuyển khoản để đối soát và nhận tiền về sau. Tắt = đơn QR mới không được ghi sổ."
            />
            <Switch
              checked={manualConfirm}
              onCheckedChange={(checked) => setDraft((current) => ({ ...current, manualConfirm: checked }))}
              disabled={disabled || manualLocked}
              className={manualLocked ? 'ops-switch-locked' : ''}
              label="Cho thu ngân bấm “Đã nhận được tiền”"
              description="Hiện nút xác nhận thủ công khi khách đã chuyển khoản mà hệ thống chưa nhận được thông báo từ ngân hàng. Mọi thu ngân đều bấm được; hệ thống ghi lại người thao tác."
            />
          </div>
          {manualLocked ? (
            <InlineAlert tone="info">
              “Đã nhận được tiền” đang không có hiệu lực vì ghi sổ đơn QR đang tắt. Bật ghi sổ đơn QR để dùng.
            </InlineAlert>
          ) : null}
          <p className="ops-hint">
            Trạng thái đang lưu trên máy chủ: nút “Đã nhận được tiền” {data.manualEffective ? 'đang hoạt động' : 'không hoạt động'}.
            Thay đổi có hiệu lực trong 30 giây sau khi lưu. Cả hai cờ mặc định là bật.
          </p>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending && confirmLines === null}>
              Lưu cài đặt QR
            </Button>
          </footer>
        </>
      )}
      <SettingsConfirmDialog
        open={confirmLines !== null}
        title="Xác nhận đổi cài đặt thanh toán QR?"
        consequences={confirmLines ?? []}
        danger
        pending={mutation.isPending}
        onCancel={() => setConfirmLines(null)}
        onConfirm={() => mutation.mutate(patch)}
      />
    </form>
  )
}
