import { useCallback, useState } from 'react'
import { clampZoomIndex, readStoredZoomIndex } from './mapZoom.ts'

/** Chỉ số mức zoom + nhớ theo trình duyệt (localStorage). Giá trị ngoài khoảng được kẹp lại. */
export function useMapZoom(storageKey: string, count: number, defaultIndex: number) {
  const [index, setIndexState] = useState(() => readStoredZoomIndex(storageKey, count, defaultIndex))
  const setIndex = useCallback(
    (next: number) => {
      const safe = clampZoomIndex(next, count, defaultIndex)
      setIndexState(safe)
      try {
        window.localStorage.setItem(storageKey, String(safe))
      } catch {
        // Trình duyệt chặn lưu trữ: vẫn dùng được, chỉ không nhớ mức zoom sau lần tải lại.
      }
    },
    [storageKey, count, defaultIndex],
  )
  return [index, setIndex] as const
}
