import { Button, Dialog } from '../../design-system/components'

type SettingsConfirmDialogProps = {
  open: boolean
  title: string
  /** Mỗi dòng là một hậu quả sẽ xảy ra khi lưu (hiện dạng danh sách). */
  consequences: readonly string[]
  confirmLabel?: string
  /** Hành động nguy hiểm (tắt chống gian lận, bật điều khiển từ xa…) ⇒ nút xác nhận màu đỏ. */
  danger?: boolean
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Hộp xác nhận dùng chung cho 7 khối thiết lập bổ sung (task settings-opts), dựng trên `Dialog`. Design-system chưa có
 * ConfirmDialog chuyên cho cài đặt có danh sách hậu quả nên làm một lần ở đây; khối nào cũng gọi như nhau.
 * Đang lưu (`pending`) thì Esc/click nền không đóng được để không mất kết quả.
 */
export function SettingsConfirmDialog({
  open,
  title,
  consequences,
  confirmLabel = 'Xác nhận và lưu',
  danger = false,
  pending = false,
  onCancel,
  onConfirm,
}: SettingsConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      description="Hãy kiểm tra kỹ trước khi lưu. Thay đổi này ảnh hưởng toàn bộ phòng máy."
      size="sm"
      onClose={pending ? () => undefined : onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            Hủy
          </Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <ul className="settings-confirm__list">
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Dialog>
  )
}
