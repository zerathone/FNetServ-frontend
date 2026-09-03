import {
  ArrowsClockwise,
  CheckCircle,
  Copy,
  CurrencyCircleDollar,
  DownloadSimple,
  Eye,
  FloppyDisk,
  FunnelSimple,
  Gift,
  HandCoins,
  Key,
  Lock,
  LockKeyOpen,
  MagnifyingGlass,
  PencilSimple,
  PlusCircle,
  Power,
  Printer,
  TrashSimple,
  XCircle,
  ClockCounterClockwise,
} from '@phosphor-icons/react'
import { Children, forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  loading?: boolean
  block?: boolean
  icon?: ReactNode
}

const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true }

/**
 * Gives common Vietnamese action labels a single, recognisable icon across
 * workspaces. Callers can always pass `icon` for a more specific action.
 */
function inferActionIcon(children: ReactNode): ReactNode | undefined {
  const label = Children.toArray(children)
    .filter((child): child is string | number => typeof child === 'string' || typeof child === 'number')
    .join(' ')
    .toLocaleLowerCase('vi-VN')

  if (!label) return undefined
  if (/làm mới|thử lại|tải lại|đồng bộ/.test(label)) return <ArrowsClockwise {...actionIconProps} />
  if (/hủy|đóng|bỏ chọn/.test(label)) return <XCircle {...actionIconProps} />
  if (/xóa|gỡ/.test(label)) return <TrashSimple {...actionIconProps} />
  if (/thêm|tạo mới|tạo thẻ|tạo combo|tạo thành viên/.test(label)) return <PlusCircle {...actionIconProps} />
  if (/lưu|cập nhật|áp dụng/.test(label)) return <FloppyDisk {...actionIconProps} />
  if (/sửa|chỉnh|đổi /.test(label)) return <PencilSimple {...actionIconProps} />
  if (/mật khẩu/.test(label)) return <Key {...actionIconProps} />
  if (/mở khóa/.test(label)) return <LockKeyOpen {...actionIconProps} />
  if (/khóa/.test(label)) return <Lock {...actionIconProps} />
  if (/tìm|tra cứu/.test(label)) return <MagnifyingGlass {...actionIconProps} />
  if (/lọc/.test(label)) return <FunnelSimple {...actionIconProps} />
  if (/xem|chi tiết|mở /.test(label)) return <Eye {...actionIconProps} />
  if (/in |in$/.test(label)) return <Printer {...actionIconProps} />
  if (/tải xuống|xuất|download/.test(label)) return <DownloadSimple {...actionIconProps} />
  if (/sao chép|copy/.test(label)) return <Copy {...actionIconProps} />
  if (/nạp|trả nợ|chuyển tiền|chi tiền|hoàn tiền/.test(label)) return <CurrencyCircleDollar {...actionIconProps} />
  if (/tặng/.test(label)) return <Gift {...actionIconProps} />
  if (/mượn/.test(label)) return <HandCoins {...actionIconProps} />
  if (/lịch sử|nhật ký/.test(label)) return <ClockCounterClockwise {...actionIconProps} />
  if (/tắt|khởi động|đăng xuất/.test(label)) return <Power {...actionIconProps} />
  if (/xác nhận|kiểm tra|duyệt|hoàn tất/.test(label)) return <CheckCircle {...actionIconProps} />
  return undefined
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    loading = false,
    block = false,
    icon,
    className = '',
    disabled,
    children,
    ...props
  },
  ref,
) {
  const resolvedIcon = icon ?? inferActionIcon(children)
  const classes = [
    'ds-button',
    `ds-button--${variant}`,
    block ? 'ds-button--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button ref={ref} className={classes} disabled={disabled || loading} {...props}>
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : resolvedIcon ? <span className="ds-button__icon">{resolvedIcon}</span> : null}
      {children}
    </button>
  )
})
