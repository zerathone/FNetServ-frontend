import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowSquareOut, Seal, SealCheck, SealPercent, SealQuestion, SealWarning,
} from '@phosphor-icons/react'
import { ApiError } from '../../api/client'
import { getLicenseInfo, getLicenseUrl, type LicenseInfo, type LicenseState } from '../../api/system'
import { Button, StatusBadge, type StatusTone } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'

// Map trạng thái (handoff webui-license §4.5) — cả 6 trạng thái dùng chung họ icon Seal (con dấu
// giấy phép). ERROR và LOCK gộp chung icon Seal trơn (phosphor không có biến thể "SealX"), phân
// biệt bằng nhãn — khác MFC gộp chung cả icon IDI_LIC_ERROR lẫn nhãn.
const STATE_META: Record<LicenseState, { tone: StatusTone; label: string; icon: ReactNode }> = {
  vip: { tone: 'success', label: 'VIP', icon: <SealPercent size={20} weight="duotone" /> },
  active: { tone: 'info', label: 'Đang hoạt động', icon: <SealCheck size={20} weight="duotone" /> },
  expiring: { tone: 'warning', label: 'Sắp hết hạn', icon: <SealWarning size={20} weight="duotone" /> },
  error: { tone: 'danger', label: 'Lỗi giấy phép', icon: <Seal size={20} weight="duotone" /> },
  locked: { tone: 'danger', label: 'Bị khoá', icon: <Seal size={20} weight="duotone" /> },
  none: { tone: 'neutral', label: 'Chưa xác thực', icon: <SealQuestion size={20} weight="duotone" /> },
}

const SYSADMIN_DISABLED_TITLE = 'Không khả dụng với tài khoản quản trị hệ thống'

// Server trả message tiếng Anh cố định (SystemHandlers.cpp: LicenseUrlRequestHandler).
function describeUrlError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'not available for sysadmin') return SYSADMIN_DISABLED_TITLE
  if (message === 'unauthorized') return 'Cần đăng nhập để xem chi tiết giấy phép'
  if (message === 'session missing staff identity') {
    return 'Phiên đăng nhập thiếu thông tin nhân viên, vui lòng đăng nhập lại'
  }
  if (error instanceof ApiError && message) return `Không mở được trang giấy phép: ${message}`
  return 'Không mở được trang giấy phép'
}

function LicenseDetails({ info }: { info: LicenseInfo }) {
  // Tách chuỗi hỏng (server tách best-effort) → hiện nguyên message thay cho các dòng rỗng.
  const parseFailed = !info.product && !info.shopName && Boolean(info.message)
  const version = [info.ver, info.rd].filter(Boolean).join(' · ')
  const rows: [string, string][] = parseFailed
    ? [
        ['Mã phòng (NetID)', info.netId],
        ['Giấy phép', info.message],
        ['Phiên bản', version],
      ]
    : [
        ['Mã phòng (NetID)', info.netId],
        ['Gói', info.product],
        ['Hạn dùng', info.expiry],
        ['Tên phòng máy', info.shopName],
        ['Điện thoại', info.phone],
        ['Email', info.email],
        ['Phiên bản', version],
      ]

  return (
    <dl className="license-button__details">
      {rows.map(([label, value]) => (
        <div key={label} className="license-button__row">
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function LicenseButton() {
  const staffId = useAuthStore((state) => state.staffId)
  const staffName = useAuthStore((state) => state.staffName)
  // Store không có cờ sysadmin; LoginPage lưu staffName = tên đăng nhập, và server chỉ cấp phiên
  // sysadmin cho đúng username "sysadmin" (staffId 0). Server vẫn từ chối nếu FE đoán sai.
  const isSystemAdmin = staffName === 'sysadmin' && staffId === 0

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  const licenseQuery = useQuery({
    queryKey: ['license-info'],
    queryFn: getLicenseInfo,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const urlMutation = useMutation<{ url: string }, unknown, Window | null>({
    mutationFn: () => getLicenseUrl(),
    onSuccess: ({ url }, tab) => {
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error, tab) => {
      tab?.close()
      pushToast(describeUrlError(error), 'error')
    },
  })

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const openDetailPage = () => {
    // Mở tab trống NGAY trong click (đồng bộ) để không bị popup blocker chặn sau await. Cắt opener
    // lúc tab còn about:blank cùng origin — sau khi sang client.fnet.com.vn sẽ ném SecurityError.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    urlMutation.mutate(tab)
  }

  const info = licenseQuery.data
  const state: LicenseState = info?.state ?? 'none'
  const meta = STATE_META[state]
  const hasLicense = Boolean(info) && state !== 'none'
  const title = hasLicense && info?.netId ? `Thông tin (${info.netId})` : 'Thông tin'
  const expiryText = hasLicense && info?.expiry ? `HSD ${info.expiry}` : ''
  const tooltip = `Giấy phép: ${meta.label}${expiryText ? ` · ${expiryText}` : ''}`

  return (
    <div className="license-button" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        className="license-button__trigger"
        title={tooltip}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`license-button__icon license-button__icon--${meta.tone}`} aria-hidden="true">
          {meta.icon}
        </span>
        <span className="license-button__text">
          <span className="license-button__title">{title}</span>
          <span className="license-button__sub">
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {expiryText ? <span>{expiryText}</span> : null}
          </span>
        </span>
      </Button>

      {open ? (
        <div id={popoverId} className="license-button__popover" role="dialog" aria-label="Thông tin giấy phép">
          <div className="license-button__popover-header">
            <strong>Giấy phép</strong>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          </div>
          {info ? (
            <LicenseDetails info={info} />
          ) : (
            <p className="license-button__empty">
              {licenseQuery.isError ? 'Không tải được thông tin giấy phép.' : 'Đang tải thông tin giấy phép…'}
            </p>
          )}
          <Button
            variant="secondary"
            block
            loading={urlMutation.isPending}
            disabled={isSystemAdmin}
            title={isSystemAdmin ? SYSADMIN_DISABLED_TITLE : undefined}
            onClick={openDetailPage}
          >
            Xem chi tiết
            <span className="ds-button__external-icon" aria-hidden="true">
              <ArrowSquareOut size={16} weight="bold" />
            </span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
