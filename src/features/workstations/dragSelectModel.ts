// Mô hình thuần (không React, không DOM) của thao tác KÉO-CHỌN / Shift+click checkbox máy trạm theo kiểu Gmail.
// Phần DOM + sự kiện chuột nằm ở useDragSelect.ts; ở đây chỉ có phép tính để chạy được dưới `node --test`.

export type Point = { x: number; y: number }

/** Hộp chữ nhật (toạ độ màn hình) của một máy — dùng để biết máy nào nằm trong khung kéo. */
export type HostRect = { host: string; left: number; top: number; right: number; bottom: number }

/**
 * Các máy từ `a` đến `b` (gồm cả hai đầu) theo thứ tự `ids`, bất kể a đứng trước hay sau b.
 * Thiếu `a` (chưa có điểm neo / máy đã bị lọc mất) ⇒ chỉ `[b]`; thiếu `b` ⇒ rỗng.
 */
export function rangeBetween(ids: readonly string[], a: string, b: string): string[] {
  const to = ids.indexOf(b)
  if (to < 0) return []
  const from = ids.indexOf(a)
  if (from < 0) return [b]
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/** Máy có hộp CẮT khung chữ nhật kéo từ `a` tới `b` (hai góc đối diện, kéo hướng nào cũng được). */
export function rectHits(rects: readonly HostRect[], a: Point, b: Point): string[] {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return rects
    .filter((rect) => rect.left < maxX && rect.right > minX && rect.top < maxY && rect.bottom > minY)
    .map((rect) => rect.host)
}

/**
 * Kiểu Gmail: lấy ẢNH CHỤP lựa chọn lúc bắt đầu kéo, rồi ép mọi máy trong vùng về cùng `value`.
 * Tính từ ảnh chụp (không cộng dồn) nên kéo ngược lại thì vùng co lại và máy ngoài vùng trả về trạng thái ban đầu.
 */
export function applyHits(base: ReadonlySet<string>, hits: Iterable<string>, value: boolean): Set<string> {
  const next = new Set(base)
  for (const host of hits) {
    if (value) next.add(host)
    else next.delete(host)
  }
  return next
}

/**
 * Thứ tự "đọc" theo mắt: hàng trên trước, trong hàng thì trái trước. Dùng cho sơ đồ (phần tử DOM không theo thứ tự hiển thị).
 * Các máy cùng hàng có đỉnh lệch nhau vài px (huy hiệu, làm tròn) nên gom hàng theo bậc `rowTolerance` px.
 */
export function visualOrder(rects: readonly HostRect[], rowTolerance = 8): string[] {
  const bucket = (rect: HostRect) => Math.round(rect.top / rowTolerance)
  return [...rects].sort((p, q) => bucket(p) - bucket(q) || p.left - q.left).map((rect) => rect.host)
}

/**
 * Tốc độ tự cuộn dọc khi chuột kéo sát mép trên / dưới khung cuộn: 0 = không cuộn; âm = lên; dương = xuống.
 * Càng sát mép (hoặc vượt ra ngoài) càng nhanh, tối đa `maxStep` px mỗi khung hình.
 */
export function edgeScrollDelta(pointerY: number, top: number, bottom: number, zone = 36, maxStep = 18): number {
  if (pointerY < top + zone) {
    const depth = Math.min(1, (top + zone - pointerY) / zone)
    return -Math.max(1, Math.round(depth * maxStep))
  }
  if (pointerY > bottom - zone) {
    const depth = Math.min(1, (pointerY - (bottom - zone)) / zone)
    return Math.max(1, Math.round(depth * maxStep))
  }
  return 0
}
