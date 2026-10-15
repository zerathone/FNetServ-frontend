// task web-print-flows — phần có hiệu ứng (react-query, fetch, localStorage) của in POS từ Web. Logic thuần
// nằm ở `posPrintModel.ts`.
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPrinters, printBitmap } from '../../api/printer'
import { MAX_TICKET_ROWS } from '../orders/printTicketModel'
import { renderPrinterHtml } from './browserHtmlRaster'
import {
  browserStorage,
  eligiblePosPrinters,
  readPosPrefs,
  writePosPrefs,
  type PosPrintPrefs,
  type PosPrintScope,
} from './posPrintModel'

/** Danh sách máy in POS in được từ Web (đang hoạt động, có IP, khổ 58/80). */
export function usePosPrinters(enabled = true) {
  const query = useQuery({
    queryKey: ['printers', 'pos'],
    queryFn: getPrinters,
    enabled,
    staleTime: 30_000,
  })
  const printers = useMemo(() => eligiblePosPrinters(query.data ?? []), [query.data])
  return { printers, isLoading: query.isLoading, isError: query.isError, error: query.error, refetch: query.refetch }
}

/**
 * Render HTML phiếu → bitmap → `/printer/print`. Ném lỗi (đã có `details` từ client) để caller dùng
 * `describePrintFailure`. KHÔNG tự thử lại, KHÔNG rollback gì (PLAN_2.11: in lỗi không ảnh hưởng tiền).
 */
export async function printHtmlToPos(input: { printerId: number; type: 1 | 2; html: string }) {
  const bitmap = await renderPrinterHtml(input.printerId, input.type, input.html)
  if (bitmap.height > MAX_TICKET_ROWS) throw new Error('Phiếu vượt giới hạn 4.096 dòng.')
  await printBitmap(bitmap)
}

/**
 * Dự phòng "A4 · trình duyệt": in CHỈ phần HTML phiếu trong iframe ẩn (KHÔNG `window.print()` cả trang web).
 * Chỉ dùng khi thu ngân chủ động chọn — mặc định luôn là máy in POS.
 */
export function printHtmlViaBrowser(bodyHtml: string, title: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const page = frame.contentDocument
  if (!page || !frame.contentWindow) {
    frame.remove()
    throw new Error('Trình duyệt không thể mở bản in A4.')
  }
  page.open()
  page.write(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title.replaceAll('<', '&lt;')}</title>` +
      `<style>@media print{@page{size:A4;margin:10mm}body{print-color-adjust:exact}}body{margin:0;background:#fff;color:#000}</style>` +
      `</head><body>${bodyHtml}</body></html>`,
  )
  page.close()
  const removeFrame = () => frame.remove()
  frame.contentWindow.onafterprint = removeFrame
  window.setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(removeFrame, 60_000)
  }, 150)
}

/** Lựa chọn in (máy in, tick thông tin phòng máy, bật in) nhớ theo trình duyệt, theo từng chỗ in. */
export function usePosPrintPrefs(scope: PosPrintScope) {
  const [prefs, setPrefs] = useState<PosPrintPrefs>(() => readPosPrefs(scope, browserStorage()))
  const update = useCallback(
    (patch: PosPrintPrefs) => {
      setPrefs((current) => {
        const next = { ...current, ...patch }
        writePosPrefs(scope, next, browserStorage())
        return next
      })
    },
    [scope],
  )
  return [prefs, update] as const
}
