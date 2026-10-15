// task web-print-flows (FE-C) — "Tự in phiếu dịch vụ sau khi hoàn tất". Qt tự in phiếu sau khi duyệt/thu, nhưng khi đơn do WEB
// duyệt/thu (REST) thì Qt không chạy ⇒ không ai in. Mặc định TẮT (Qt vẫn tự in đơn khách đặt từ máy trạm / đơn Qt tạo — web
// không được in thêm trùng); thu ngân bật theo từng trình duyệt. Dùng lại ĐÚNG đường của nút "In phiếu": `/orders/print-targets`
// định tuyến món → máy in (`printservicetb`) rồi bitmap → `/printer/print`. In lỗi KHÔNG ảnh hưởng tiền, KHÔNG tự thử lại.
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { getPrintTargets } from '../../api/orders'
import { pushToast } from '../../store/toast'
import { printHtmlToPos } from '../printers/posPrint'
import { browserStorage, readPosPrefs, writePosPrefs } from '../printers/posPrintModel'
import { buildServiceTicketHtml, describePrintFailure, printerPaper, splitPrinters } from './printTicketModel'
import '../printers/pos-print.css'

// Trạng thái bật/tắt dùng chung cho mọi nơi trong tab (OrderWorkspace + StaffOrderDialog ...). `null` = chưa đọc storage.
let current: boolean | null = null
const listeners = new Set<() => void>()

function getSnapshot() {
  if (current === null) current = readPosPrefs('service', browserStorage()).enabled === true
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setEnabledShared(value: boolean) {
  current = value
  const storage = browserStorage()
  writePosPrefs('service', { ...readPosPrefs('service', storage), enabled: value }, storage)
  listeners.forEach((listener) => listener())
}

/** Gửi phiếu tới mọi máy in được gán cho các dòng. Không ném: mọi lỗi đi vào toast. */
async function autoPrintServiceTickets(detailIds: number[]) {
  if (detailIds.length === 0) return
  try {
    const targets = await getPrintTargets({ detailIds })
    const { printable, unsupported } = splitPrinters(targets)
    if (printable.length === 0) {
      // Món không gán máy in nào là bình thường (Qt cũng không in) — chỉ báo khi CÓ máy gán nhưng web không in được.
      if (unsupported.length > 0) {
        pushToast('Có món gán máy in không hỗ trợ in từ Web (chưa có IP hoặc không phải POS 58/80). Bấm "In phiếu" để xem chi tiết.', 'info')
      }
      return
    }
    // Song song: máy in offline giữ 1 luồng HTTP ~6 giây — tuần tự N máy sẽ treo N×6 giây (xem PrintTicketDialog).
    const results = await Promise.allSettled(
      printable.map((printer) => {
        const paper = printerPaper(printer.type)
        if (!paper) return Promise.reject(new Error('Máy in không phải khổ POS 58/80.'))
        return printHtmlToPos({
          printerId: printer.printerId,
          type: paper.type,
          html: buildServiceTicketHtml({ header: targets.header, printerName: printer.name, items: printer.items, type: paper.type }),
        })
      }),
    )
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed.length === 0) {
      pushToast(`Đã gửi phiếu tới ${printable.length} máy in.`, 'success')
      return
    }
    pushToast(
      `Tự in phiếu lỗi ở ${failed.length}/${printable.length} máy in: ${describePrintFailure(failed[0].reason).message} ` +
        'Tiền đã ghi. Bấm "In phiếu" của đơn để in lại (bỏ chọn máy đã in).',
      'error',
    )
  } catch (error) {
    pushToast(
      `Không tra được máy in để tự in phiếu: ${describePrintFailure(error).message} Tiền đã ghi — bấm "In phiếu" của đơn để in thủ công.`,
      'error',
    )
  }
}

export type ServiceAutoPrint = {
  enabled: boolean
  setEnabled: (value: boolean) => void
  /** Gọi SAU khi duyệt/thu thành công với ĐÚNG `detailId` của giao dịch. No-op khi tắt. */
  run: (detailIds: number[]) => void
  toggle: ReactNode
}

export function useServiceAutoPrint(): ServiceAutoPrint {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const run = useCallback((detailIds: number[]) => {
    if (!getSnapshot()) return
    void autoPrintServiceTickets(detailIds)
  }, [])
  const toggle = (
    <label
      className="pos-print-picker__check"
      title="Chỉ áp dụng cho đơn do Web duyệt/thu. Bật khi quầy chỉ dùng Web UI — nếu quầy vẫn dùng phần mềm Qt thì Qt đã tự in."
    >
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabledShared(event.target.checked)} />
      <span>Tự in phiếu sau khi hoàn tất</span>
    </label>
  )
  return { enabled, setEnabled: setEnabledShared, run, toggle }
}
