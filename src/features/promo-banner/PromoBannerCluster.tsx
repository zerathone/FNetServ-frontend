import { useMutation, useQuery } from '@tanstack/react-query'
import { getPromoBanners, getPromoClickUrl, type PromoBannerItem } from '../../api/promo'
import { pushToast } from '../../store/toast'

const VALID_IMAGE_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,']
const OPEN_FAILED_MESSAGE = 'Không mở được trang quảng cáo'

function isValidImage(image: string) {
  return VALID_IMAGE_PREFIXES.some((prefix) => image.startsWith(prefix))
}

function isHttpsUrl(url: string) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// Mirror m_dynPromotionButtons MFC (ServerSideDlg.cpp:3798-3934): cụm banner quảng cáo động,
// cùng nguồn f0 (Authen::get_features), neo cạnh "Giao dịch online". Backend đã lọc khung giờ +
// kiểm URL/ảnh — FE vẫn tự kiểm lại scheme https trước khi điều hướng tab: tab about:blank mở
// đồng bộ cùng-origin với web UI, một URL không hợp lệ lọt qua có thể đọc token trong
// sessionStorage (giống lý do PaymentOnlineButton/LicenseButton kiểm lại phía server).
export function PromoBannerCluster() {
  const bannersQuery = useQuery({
    queryKey: ['promo-banners'],
    queryFn: getPromoBanners,
    refetchInterval: 60 * 60_000,
    staleTime: 5 * 60_000,
  })

  const clickMutation = useMutation<{ url: string }, unknown, { id: string; tab: Window | null }>({
    mutationFn: ({ id }) => getPromoClickUrl(id),
    onSuccess: ({ url }, { tab }) => {
      if (!isHttpsUrl(url)) {
        tab?.close()
        pushToast(OPEN_FAILED_MESSAGE, 'error')
        return
      }
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    onError: (_error, { tab }) => {
      tab?.close()
      pushToast(OPEN_FAILED_MESSAGE, 'error')
    },
  })

  const items = (bannersQuery.data?.items ?? []).filter((item: PromoBannerItem) => isValidImage(item.image))

  if (items.length === 0) return null

  const handleClick = (id: string) => {
    // Đồng bộ trước await để không bị popup blocker chặn (giống PaymentOnlineButton).
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    clickMutation.mutate({ id, tab })
  }

  return (
    <div className="promo-banner-cluster">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="promo-banner-cluster__item"
          aria-label="Quảng cáo"
          onClick={() => handleClick(item.id)}
        >
          <img src={item.image} width={item.w} height={item.h} alt="" draggable={false} />
        </button>
      ))}
    </div>
  )
}
