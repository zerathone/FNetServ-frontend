import { useState, type ReactNode } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Button } from '../../design-system/components'

/**
 * Nút đóng/mở "Xem trước kết quả" trong hộp xác nhận Chốt kho / Chốt kỳ: mặc định đóng cho form gọn; mở ra thì hiện bảng (cuộn
 * khi dài) mà trang gọi truyền vào làm `children`. Dùng chung cho kho hàng hóa và kho nguyên liệu.
 * `loading`: đang tính kết quả (nút khoá); `error`: không tính được (hiện lý do bên dưới, nút khoá).
 */
export function ClosingPreviewToggle({
  count,
  loading = false,
  error,
  children,
}: {
  count: number
  loading?: boolean
  error?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const label = loading ? 'Đang tính kết quả…' : `${open ? 'Ẩn' : 'Xem'} trước kết quả (${count})`
  return (
    <div className="inv-form__wide inv-closing-preview">
      <Button
        type="button"
        variant="ghost"
        icon={open ? <CaretUp size={14} weight="bold" aria-hidden="true" /> : <CaretDown size={14} weight="bold" aria-hidden="true" />}
        aria-expanded={open}
        disabled={loading || count === 0}
        onClick={() => setOpen((cur) => !cur)}
      >
        {label}
      </Button>
      {error ? <p className="inv-closing-preview__hint">Không xem trước được: {error}</p> : null}
      {open && !loading ? <div className="inv-closing-preview__body">{children}</div> : null}
    </div>
  )
}
