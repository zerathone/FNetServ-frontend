// task work-shift S3 (F2) — in lại phiếu của một ca ĐÃ ĐÓNG từ trang quản lý. Dùng lại HTML phiếu chốt ca của F1
// (`buildCloseTicketHtml`) và cách in của Dialog Chốt ca (máy in POS, không có máy in thì in bằng trình duyệt).
import { Printer } from '@phosphor-icons/react'
import { useState } from 'react'
import type { ShiftCloseResult } from '../../api/shift'
import { Button, InlineAlert } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { useLicenseInfo } from '../license/useLicenseInfo'
import { describePrintFailure, printerPaper } from '../orders/printTicketModel'
import { PosPrinterPicker } from '../printers/PosPrinterPicker'
import { printHtmlToPos, printHtmlViaBrowser, usePosPrintPrefs, usePosPrinters } from '../printers/posPrint'
import { pickPrinterId } from '../printers/posPrintModel'
import { buildCloseTicketHtml } from './shiftModel'
import './shifts.css'

export function ShiftPrintSection({ result }: { result: ShiftCloseResult }) {
  const licenseQuery = useLicenseInfo()
  const shopName = licenseQuery.data?.shopName || ''
  const { printers, isLoading, isError, error } = usePosPrinters()
  const [prefs, updatePrefs] = usePosPrintPrefs('shift')
  const printerId = pickPrinterId(printers, prefs.printerId, undefined)
  const [printing, setPrinting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const printer = printers.find((item) => item.printerId === printerId)
  const paper = printer ? printerPaper(printer.type) : null
  const shiftId = result.shift.shiftId

  const printPos = async () => {
    if (!printer || !paper) return
    setPrinting(true)
    setFailure(null)
    try {
      await printHtmlToPos({
        printerId,
        type: paper.type,
        html: buildCloseTicketHtml({ shopName, result, type: paper.type }),
      })
      pushToast(`Đã gửi phiếu ca #${shiftId} tới máy in.`, 'success')
    } catch (failureReason) {
      setFailure(describePrintFailure(failureReason).message)
    } finally {
      setPrinting(false)
    }
  }

  const printBrowser = () => {
    try {
      printHtmlViaBrowser(
        `<div style="max-width:80mm">${buildCloseTicketHtml({ shopName, result, type: 1 })}</div>`,
        `Phiếu chốt ca #${shiftId}`,
      )
    } catch (failureReason) {
      setFailure((failureReason as Error).message)
    }
  }

  return (
    <section className="shift-print" aria-label="In phiếu ca">
      <PosPrinterPicker
        idPrefix="shift-manage"
        printers={printers}
        printerId={printerId}
        onPrinterChange={(value) => updatePrefs({ printerId: value })}
        loading={isLoading}
        errorMessage={isError ? (error as Error).message : undefined}
        disabled={printing}
      />
      <div className="shift-actions">
        {printers.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            loading={printing}
            icon={<Printer size={18} weight="bold" aria-hidden="true" />}
            onClick={() => void printPos()}
          >
            In phiếu ca
          </Button>
        ) : null}
        <Button
          type="button"
          variant={printers.length > 0 ? 'ghost' : 'secondary'}
          icon={<Printer size={18} weight="bold" aria-hidden="true" />}
          onClick={printBrowser}
        >
          In bằng trình duyệt
        </Button>
      </div>
      {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
    </section>
  )
}
