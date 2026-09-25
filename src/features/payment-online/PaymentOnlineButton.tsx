import { useMutation, useQuery } from '@tanstack/react-query'
import { CurrencyCircleDollar } from '@phosphor-icons/react'
import { ApiError } from '../../api/client'
import { getPaymentOnlineInfo, getPaymentOnlineUrl } from '../../api/system'
import { Button } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'

const SYSADMIN_DISABLED_TITLE = 'Không khả dụng với tài khoản quản trị hệ thống'
const UNAVAILABLE_TITLE = 'Giao dịch online chưa được kích hoạt cho phòng máy này'

// Server tra message tieng Anh co dinh (SystemHandlers.cpp: PaymentOnlineUrlRequestHandler).
function describeUrlError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'not available for sysadmin') return SYSADMIN_DISABLED_TITLE
  if (message === 'payment online not available') return UNAVAILABLE_TITLE
  if (message === 'unauthorized') return 'Cần đăng nhập để mở giao dịch online'
  if (message === 'session missing staff identity') {
    return 'Phiên đăng nhập thiếu thông tin nhân viên, vui lòng đăng nhập lại'
  }
  if (message === 'not ready') return 'Server chưa sẵn sàng, vui lòng thử lại sau'
  if (error instanceof ApiError && message) return `Không mở được giao dịch online: ${message}`
  return 'Không mở được giao dịch online'
}

// Mirror nut "Giao dich online" (m_btnPaymentOnline) MFC: bat/tat theo Authen::get_payment_url(),
// bam mo URL portal thanh toan do server dung (Authen::url_payment_transaction).
export function PaymentOnlineButton() {
  const staffId = useAuthStore((state) => state.staffId)
  const staffName = useAuthStore((state) => state.staffName)
  // Giong LicenseButton: store khong co co sysadmin, doan theo quy uoc dang nhap; server van tu
  // choi neu doan sai.
  const isSystemAdmin = staffName === 'sysadmin' && staffId === 0

  const infoQuery = useQuery({
    queryKey: ['payment-online-info'],
    queryFn: getPaymentOnlineInfo,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const urlMutation = useMutation<{ url: string }, unknown, Window | null>({
    mutationFn: () => getPaymentOnlineUrl(),
    onSuccess: ({ url }, tab) => {
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (error, tab) => {
      tab?.close()
      pushToast(describeUrlError(error), 'error')
    },
  })

  // Mac dinh tat cho toi khi biet chac available (giong ShowDlgText() reset EnableWindow(FALSE)
  // luc khoi dong/dang xuat, ServerSideDlg.cpp:1784).
  const available = infoQuery.data?.available === true
  const disabled = isSystemAdmin || !available
  const title = isSystemAdmin ? SYSADMIN_DISABLED_TITLE : !available ? UNAVAILABLE_TITLE : undefined

  const openPaymentPortal = () => {
    // Dong bo truoc await de khong bi popup blocker chan (giong LicenseButton).
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    urlMutation.mutate(tab)
  }

  return (
    <Button
      variant="ghost"
      className="payment-online-button"
      title={title}
      disabled={disabled}
      loading={urlMutation.isPending}
      onClick={openPaymentPortal}
    >
      <span className="payment-online-button__icon" aria-hidden="true">
        <CurrencyCircleDollar size={20} weight="duotone" />
      </span>
      <span className="payment-online-button__label">Giao dịch online</span>
    </Button>
  )
}
