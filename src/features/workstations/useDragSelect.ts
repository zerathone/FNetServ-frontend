import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  applyHits,
  edgeScrollDelta,
  rangeBetween,
  rectHits,
  visualOrder,
  type HostRect,
  type Point,
} from './dragSelectModel.ts'

// Kéo-chọn + Shift+click checkbox máy trạm theo kiểu Gmail (dùng cho bảng Chi tiết, lưới Biểu tượng, Sơ đồ, ngăn kéo Mở máy trạm).
//
//  - Bấm xuống một checkbox rồi kéo (quá DRAG_THRESHOLD px): mọi máy trong vùng kéo bị ép về trạng thái NGƯỢC với checkbox lúc bấm
//    (bắt đầu ở ô chưa tick ⇒ tick cả vùng; bắt đầu ở ô đã tick ⇒ bỏ tick cả vùng). Kéo ngược lại thì vùng co lại.
//  - Bấm thường (không kéo): không làm gì — click gốc của checkbox vẫn chạy như cũ.
//  - Shift+bấm: chọn / bỏ chọn cả dải từ checkbox bấm gần nhất tới checkbox này, cùng trạng thái ngược lúc bấm.
//  - Esc khi đang kéo: huỷ, trả về lựa chọn lúc bắt đầu. Chuột sát mép khung cuộn: tự cuộn.
//
// Cách gắn: spread `onPointerDown` lên phần tử BAO các máy; checkbox máy có `data-host-check="<tên máy>"`; phần tử đại diện mỗi máy
// (để biết máy nằm ở đâu) có `data-host="<tên máy>"`. Checkbox khác (vd "chọn tất cả") không có thuộc tính nên không bị ảnh hưởng.

export const HOST_ATTR = 'data-host'
export const CHECK_ATTR = 'data-host-check'

const DRAG_THRESHOLD = 4

export type DragSelectContext = {
  container: HTMLElement
  /** Điểm bắt đầu kéo, ĐÃ bù phần khung cuộn đã trôi (toạ độ màn hình hiện tại). */
  start: Point
  current: Point
  startHost: string
}

export type DragSelectOptions = {
  selected: ReadonlySet<string>
  /** Nhận TOÀN BỘ tập mới (đã gồm các máy ngoài vùng kéo — giữ nguyên). */
  onChange: (next: Set<string>) => void
  /** Thứ tự máy cho Shift+click. Mặc định: thứ tự trong DOM. */
  orderedIds?: (container: HTMLElement) => readonly string[]
  /** Máy trong vùng kéo. Mặc định: các máy có hộp cắt khung chữ nhật (kèm khung chọn hiện trên màn hình). */
  getHits?: (context: DragSelectContext) => readonly string[]
  /** Khung cuộn dọc cần tự cuộn. Mặc định: tổ tiên cuộn được gần nhất của vùng bao. */
  scrollEl?: (container: HTMLElement) => HTMLElement | null
  /** Sắp thứ tự Shift+click theo vị trí trên màn hình thay vì thứ tự DOM (sơ đồ). */
  spatialOrder?: boolean
}

/** Hộp của các máy trong vùng bao — bỏ máy bị lọc mờ trên sơ đồ (`.wsmap-dim`) và phần tử chưa có kích thước. */
function collectRects(container: HTMLElement): HostRect[] {
  const rects: HostRect[] = []
  container.querySelectorAll<HTMLElement>(`[${HOST_ATTR}]`).forEach((element) => {
    const host = element.getAttribute(HOST_ATTR)
    if (!host || element.closest('.wsmap-dim')) return
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return
    rects.push({ host, left: box.left, top: box.top, right: box.right, bottom: box.bottom })
  })
  return rects
}

/** Khung cuộn dọc gần nhất, TÍNH CẢ chính `element` (vd `.ws-icon-view` tự cuộn) rồi mới tới tổ tiên. */
function nearestScrollParent(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node
  }
  return null
}

/**
 * Sau một lần kéo / Shift+bấm, trình duyệt vẫn bắn `click` (nếu nhả đúng lên checkbox cũ) làm đảo lại giá trị:
 * nuốt đúng MỘT click đó. Tự gỡ khi có click đó hoặc ở lần bấm xuống kế tiếp (nếu không có click nào tới).
 */
function swallowNextClick() {
  const off = () => {
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('pointerdown', off, true)
  }
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    off()
  }
  document.addEventListener('click', onClick, true)
  document.addEventListener('pointerdown', off, true)
}

export function useDragSelect(options: DragSelectOptions) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const anchorRef = useRef<string | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  // Rời trang giữa lúc đang kéo: gỡ listener + khung chọn.
  useEffect(() => () => abortRef.current?.(), [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Cảm ứng: kéo là cuộn trang — không chiếm. Chỉ chuột trái / bút.
    if (event.button !== 0 || event.pointerType === 'touch') return
    const input = (event.target as Element).closest?.(`input[type="checkbox"][${CHECK_ATTR}]`)
    const host = input?.getAttribute(CHECK_ATTR)
    if (!host) return

    const container = event.currentTarget
    const initial = optionsRef.current
    const willBe = !initial.selected.has(host)

    // ---- Shift+bấm: cả dải từ điểm neo ----
    if (event.shiftKey && anchorRef.current && anchorRef.current !== host) {
      const ids = initial.orderedIds
        ? initial.orderedIds(container)
        : initial.spatialOrder
          ? visualOrder(collectRects(container))
          : collectRects(container).map((rect) => rect.host)
      initial.onChange(applyHits(initial.selected, rangeBetween(ids, anchorRef.current, host), willBe))
      anchorRef.current = host
      event.preventDefault() // đừng bôi đen chữ giữa hai ô
      swallowNextClick()
      return
    }
    anchorRef.current = host

    // ---- Chuẩn bị kéo (chỉ thật sự kéo khi chuột đi quá ngưỡng) ----
    const base = new Set(initial.selected)
    const scroller = (initial.scrollEl ?? nearestScrollParent)(container)
    const startPoint: Point = { x: event.clientX, y: event.clientY }
    const startScroll = { left: scroller?.scrollLeft ?? 0, top: scroller?.scrollTop ?? 0 }
    let current = startPoint
    let active = false
    let frame = 0
    let lastKey = ''
    let marquee: HTMLDivElement | null = null

    const compute = () => {
      const opts = optionsRef.current
      // Khung cuộn trôi bao nhiêu thì điểm bắt đầu trôi theo bấy nhiêu (nội dung dịch chuyển, chuột đứng yên).
      const start: Point = {
        x: startPoint.x - ((scroller?.scrollLeft ?? 0) - startScroll.left),
        y: startPoint.y - ((scroller?.scrollTop ?? 0) - startScroll.top),
      }
      const hits = opts.getHits
        ? opts.getHits({ container, start, current, startHost: host })
        : rectHits(collectRects(container), start, current)
      const all = hits.includes(host) ? hits : [host, ...hits]
      const key = all.join('\n')
      if (key !== lastKey) {
        lastKey = key
        opts.onChange(applyHits(base, all, willBe))
      }
      if (marquee) {
        marquee.style.left = `${Math.min(start.x, current.x)}px`
        marquee.style.top = `${Math.min(start.y, current.y)}px`
        marquee.style.width = `${Math.abs(current.x - start.x)}px`
        marquee.style.height = `${Math.abs(current.y - start.y)}px`
      }
    }

    const tick = () => {
      frame = 0
      if (!active) return
      if (scroller) {
        const box = scroller.getBoundingClientRect()
        const step = edgeScrollDelta(current.y, box.top, box.bottom)
        if (step !== 0) {
          scroller.scrollTop += step
          compute()
        }
      }
      frame = requestAnimationFrame(tick)
    }

    const onMove = (moveEvent: PointerEvent) => {
      current = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (!active) {
        if (Math.hypot(current.x - startPoint.x, current.y - startPoint.y) < DRAG_THRESHOLD) return
        active = true
        document.body.classList.add('ws-drag-selecting')
        window.getSelection()?.removeAllRanges()
        if (!optionsRef.current.getHits) {
          marquee = document.createElement('div')
          marquee.className = 'ws-marquee'
          document.body.appendChild(marquee)
        }
        frame = requestAnimationFrame(tick)
      }
      compute()
    }

    const finish = (commit: boolean) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
      document.body.classList.remove('ws-drag-selecting')
      marquee?.remove()
      abortRef.current = null
      if (!active) return // bấm thường: để click gốc của checkbox xử lý
      if (!commit) optionsRef.current.onChange(new Set(base))
      swallowNextClick()
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') finish(false)
    }

    abortRef.current = () => finish(false)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('keydown', onKey)
  }, [])

  return { onPointerDown }
}
