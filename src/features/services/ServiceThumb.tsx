import { useQuery } from '@tanstack/react-query'
import { ImageSquare } from '@phosphor-icons/react'
import { getServiceImage } from '../../api/serviceCatalog'
import type { ServiceItem } from '../../api/services'
import { useNearViewport } from './useNearViewport'

/**
 * Ảnh vuông 32px của món trong danh sách.
 *
 * Server chỉ trả ảnh qua POST `/service/catalog/image/get` (base64, ảnh gốc ≤ 600×600) — `<img>` không gửi được Bearer
 * nên không có URL trực tiếp. Vì vậy chỉ tải khi dòng THỰC SỰ vào khung nhìn, và dùng cùng queryKey với hộp thoại Sửa
 * để hai nơi chia sẻ cache.
 */
export function ServiceThumb({ service }: { service: ServiceItem }) {
  const hasImage = (service.serviceImg ?? '') !== ''
  const { ref, near } = useNearViewport<HTMLSpanElement>(hasImage)

  const imageQuery = useQuery({
    queryKey: ['services', 'image', service.id, service.serviceImg ?? ''],
    queryFn: () => getServiceImage(service.id),
    enabled: hasImage && near,
    staleTime: 5 * 60_000,
  })

  const data = imageQuery.data
  const src = data?.hasImage && data.imageBase64 ? `data:${data.mime ?? 'image/jpeg'};base64,${data.imageBase64}` : ''

  return (
    <span className="service-thumb" ref={ref} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <ImageSquare size={18} weight="regular" />}
    </span>
  )
}
