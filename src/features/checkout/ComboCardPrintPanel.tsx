// task web-print-flows (FE-A) — khối "In thẻ COMBO" thay `window.print()`: chọn máy in POS đã khai báo, gửi bitmap qua
// `/printer/print` (cùng đường với Qt). Mỗi thẻ MỘT lệnh in để máy cắt giấy tách từng thẻ. In lỗi KHÔNG tự thử lại.
import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Printer } from '@phosphor-icons/react'
import type { Combo, ComboSaleResult } from '../../api/combo'
import { getCafeInfo } from '../../api/settings'
import { Button, InlineAlert } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { printerPaper, describePrintFailure } from '../orders/printTicketModel'
import { PosPrinterPicker } from '../printers/PosPrinterPicker'
import { printHtmlToPos, printHtmlViaBrowser, usePosPrintPrefs, usePosPrinters } from '../printers/posPrint'
import { hasRoomInfo, formatReceiptDateTime, formatSystemDateTime, pickPrinterId } from '../printers/posPrintModel'
import { buildComboCardHtml, formatComboCredentialsText, toComboCardData } from './comboCardPrintModel'

type Props = {
  results: ComboSaleResult[]
  /** Danh mục combo đang bán — bù các trường BE cũ chưa trả. */
  combosById: ReadonlyMap<number, Combo>
  onBusyChange?: (busy: boolean) => void
}

const iconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

function downloadText(text: string) {
  const today = new Date().toISOString().slice(0, 10)
  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `the-combo-${today}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ComboCardPrintPanel({ results, combosById, onBusyChange }: Props) {
  const queryClient = useQueryClient()
  const staffName = useAuthStore((state) => state.staffName)
  const { printers, isLoading, isError, error } = usePosPrinters()
  const [prefs, updatePrefs] = usePosPrintPrefs('combo')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)

  const printerId = useMemo(() => pickPrinterId(printers, prefs.printerId, undefined), [printers, prefs.printerId])
  const roomInfo = prefs.roomInfo ?? false

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const cards = useMemo(() => {
    const context = {
      fallbackIssuedAt: formatSystemDateTime(new Date()),
      fallbackStaffName: staffName,
    }
    return results.map((result) => toComboCardData(result, combosById.get(result.comboId), context))
  }, [results, combosById, staffName])

  // Giờ dự phòng hiển thị cùng dạng với phiếu Qt "dd/mm/yyyy HH:mm".
  const displayCards = useMemo(
    () => cards.map((card) => ({ ...card, issuedAt: formatReceiptDateTime(card.issuedAt) })),
    [cards],
  )

  const loadCafe = async () => {
    if (!roomInfo) return null
    const cafe = await queryClient.fetchQuery({
      queryKey: ['settings', 'cafeinfo'],
      queryFn: getCafeInfo,
      staleTime: 60_000,
    })
    if (!hasRoomInfo(cafe)) {
      throw new Error('Chưa khai báo tên phòng máy trong Cài đặt nên không in được thông tin phòng máy.')
    }
    return cafe
  }

  const printPos = async () => {
    const printer = printers.find((item) => item.printerId === printerId)
    const paper = printer ? printerPaper(printer.type) : null
    if (!printer || !paper) {
      setStatus({ tone: 'danger', message: 'Hãy chọn máy in POS đang hoạt động.' })
      return
    }
    setBusy(true)
    setStatus(null)
    let sent = 0
    try {
      const cafe = await loadCafe()
      for (const card of displayCards) {
        // Tuần tự và dừng ở thẻ lỗi: không tự thử lại để khỏi in trùng, báo rõ đã gửi bao nhiêu thẻ.
        await printHtmlToPos({
          printerId,
          type: paper.type,
          html: buildComboCardHtml({ card, printerName: printer.printerName, type: paper.type, cafe }),
        })
        sent += 1
      }
      setStatus({ tone: 'success', message: `Đã gửi ${sent} thẻ tới máy in ${printer.printerName}.` })
      pushToast(`Đã gửi ${sent} thẻ COMBO tới máy in.`, 'success')
    } catch (failure) {
      const { message } = describePrintFailure(failure)
      setStatus({
        tone: 'danger',
        message: `${message} Đã gửi ${sent}/${displayCards.length} thẻ. Không tự gửi lại — kiểm tra máy in rồi bấm in lại, hoặc dùng Sao chép / Tải .txt.`,
      })
    } finally {
      setBusy(false)
    }
  }

  const printA4 = async () => {
    setStatus(null)
    try {
      const cafe = await loadCafe()
      const body = displayCards
        .map(
          (card) =>
            `<div style="display:inline-block;width:315px;vertical-align:top;margin:5mm;padding:4px;border:1px solid #000;break-inside:avoid">${buildComboCardHtml({ card, printerName: 'A4', type: 1, cafe })}</div>`,
        )
        .join('')
      printHtmlViaBrowser(body, 'Thẻ COMBO')
      setStatus({ tone: 'success', message: 'Đã mở hộp thoại in A4 của trình duyệt.' })
    } catch (failure) {
      setStatus({ tone: 'danger', message: failure instanceof Error ? failure.message : 'Không mở được bản in A4.' })
    }
  }

  const copyCredentials = async () => {
    try {
      await navigator.clipboard.writeText(formatComboCredentialsText(cards))
      pushToast('Đã sao chép tài khoản và mật khẩu.', 'success')
    } catch {
      pushToast('Không thể truy cập clipboard. Hãy tải file thay thế.', 'error')
    }
  }

  return (
    <div className="pos-print-block" aria-label="In thẻ COMBO">
      <PosPrinterPicker
        idPrefix="combo-print"
        printers={printers}
        printerId={printerId}
        onPrinterChange={(value) => updatePrefs({ printerId: value })}
        roomInfo={roomInfo}
        onRoomInfoChange={(value) => updatePrefs({ roomInfo: value })}
        loading={isLoading}
        errorMessage={isError ? (error as Error).message : undefined}
        disabled={busy}
        inline
        actions={
          <Button
            type="button"
            variant="primary"
            icon={<Printer {...iconProps} />}
            loading={busy}
            disabled={!printerId || displayCards.length === 0}
            onClick={() => void printPos()}
          >
            In {displayCards.length} thẻ
          </Button>
        }
        secondaryActions={
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void printA4()}>
              In trình duyệt
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void copyCredentials()}>
              Sao chép
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => downloadText(formatComboCredentialsText(cards))}>
              Tải .txt
            </Button>
          </>
        }
      />
      {status ? <InlineAlert tone={status.tone === 'success' ? 'success' : 'danger'}>{status.message}</InlineAlert> : null}
    </div>
  )
}
