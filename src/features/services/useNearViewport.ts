import { useEffect, useRef, useState } from 'react'

/**
 * `true` (và giữ nguyên) khi phần tử đã tới gần khung nhìn — để dòng danh sách chỉ tải dữ liệu phụ (ảnh, công thức)
 * khi người dùng thực sự cuộn tới, thay vì bắn request cho cả trang. `enabled=false` ⇒ không theo dõi.
 */
export function useNearViewport<T extends Element>(enabled = true) {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!enabled || near || !node) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, near])

  return { ref, near }
}
