// task web-print-flows (FE-B) — in PHIẾU NẠP TIỀN từ Web, dùng chung cho 3 chỗ nạp (Khách hàng, Hội viên, Màn hình máy).
// Parity MFC `CUserDepositMoneyDlg::print_receipt`: chỉ khi license có FN1; ô "In phiếu" mặc định theo cờ option 139 (cờ/máy in/
// "In thông tin phòng máy" chỉ ĐỌC từ option, lựa chọn của web nhớ ở trình duyệt); riêng dòng "Ghi chú" của phiếu thì ĐỌC và GHI
// ngược vào option 139 như hộp thoại cấu hình của MFC; in SAU khi nạp thành công; in lỗi KHÔNG ảnh hưởng tiền đã ghi và không tự thử lại.
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCafeInfo, getSettingsOptions, saveDepositReceiptNote } from '../../api/settings'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { useLicenseInfo } from '../license/useLicenseInfo'
import { describePrintFailure, printerPaper } from '../orders/printTicketModel'
import { PosPrinterPicker } from '../printers/PosPrinterPicker'
import { printHtmlToPos, usePosPrintPrefs, usePosPrinters } from '../printers/posPrint'
import { formatSystemDateTime, pickPrinterId } from '../printers/posPrintModel'
import '../printers/pos-print.css'
import {
  buildDepositReceiptHtml,
  depositMethodLabel,
  isPrintableDepositAmount,
  parseDepositPrintConfig,
} from './depositReceiptModel'
import type { DepositMethod } from './depositModel'

export type DepositPrintRequest = {
  username: string
  amount: number | null | undefined
  method: DepositMethod
  /** Máy trạm của hội viên đang online (nếu biết). */
  machine?: string
}

type PrintJob = {
  username: string
  amount: number
  methodLabel: string
  machine: string
  issueDate: string
  staffName: string
  printerId: number
  roomInfo: boolean
  note: string
}

export function useDepositReceiptPrint() {
  const queryClient = useQueryClient()
  const staffName = useAuthStore((state) => state.staffName)
  const licenseQuery = useLicenseInfo()
  // MFC `print_receipt` chỉ chạy khi `Authen::FN1` (UserDepositMoneyDlg.cpp:2298) — không FN1 thì web không hiện ô, không in lén.
  const available = licenseQuery.data?.fn1 === true

  const optionQuery = useQuery({
    queryKey: ['settings-options', 'print_deposit_receipt'],
    queryFn: () => getSettingsOptions(['print_deposit_receipt']),
    enabled: available,
    staleTime: 60_000,
  })
  const option = optionQuery.data?.items.print_deposit_receipt
  const config = useMemo(() => parseDepositPrintConfig(option?.value), [option?.value])
  const { printers, isLoading, isError, error } = usePosPrinters(available)
  const [prefs, updatePrefs] = usePosPrintPrefs('deposit')

  const enabled = prefs.enabled ?? option?.active === 1
  const roomInfo = prefs.roomInfo ?? config?.cafeInfo ?? false
  const printerId = useMemo(
    () => pickPrinterId(printers, prefs.printerId, config?.printer),
    [printers, prefs.printerId, config?.printer],
  )

  // Ghi chú cố định của phiếu = trường `note` của option 139 (MFC: ô "Ghi chú" ở hộp thoại cấu hình in phiếu).
  // Nạp từ cấu hình; sửa trong ô thì lưu xuống DB khi rời ô / Enter (PUT /settings/deposit-receipt-note) rồi
  // in đúng chuỗi đó — giống MFC (config.note được in, không phải ghi chú giao dịch).
  const savedNote = config?.note ?? ''
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const note = noteDraft ?? savedNote
  const noteMutation = useMutation({
    mutationFn: (value: string) => {
      const printer = printers.find((item) => item.printerId === printerId)
      const paper = printer ? printerPaper(printer.type) : null
      // Chỉ cần khi CHƯA có cấu hình (server tạo mới): bảng MFC A4=0, POS58=1, POS80=2 — ngược `printertb.Type`.
      return saveDepositReceiptNote({
        note: value,
        printer: printer?.printerName,
        paperType: paper ? (paper.type === 1 ? 2 : 1) : undefined,
        cafeInfo: roomInfo,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-options', 'print_deposit_receipt'] })
      setNoteDraft(null)
    },
    onError: (failureReason: Error) => pushToast(`Chưa lưu được ghi chú phiếu nạp tiền: ${failureReason.message}`, 'error'),
  })
  const commitNote = () => {
    if (noteDraft === null) return
    const value = noteDraft.trim()
    if (value === savedNote) {
      setNoteDraft(null)
      return
    }
    noteMutation.mutate(value)
  }

  const [failure, setFailure] = useState<{ message: string; job: PrintJob } | null>(null)
  const [retrying, setRetrying] = useState(false)

  const send = useCallback(
    async (job: PrintJob) => {
      const printer = printers.find((item) => item.printerId === job.printerId)
      const paper = printer ? printerPaper(printer.type) : null
      if (!printer || !paper) throw new Error('Chưa có máy in POS đang hoạt động để in phiếu nạp tiền.')
      let cafe = null
      if (job.roomInfo) {
        // Chua khai bao ten phong may thi van in khoi thong tin phong may, cac truong
        // trong de trong tren phieu (roomInfoRowsHtml luon in du dong) -- KHONG chan in.
        cafe = await queryClient.fetchQuery({ queryKey: ['settings', 'cafeinfo'], queryFn: getCafeInfo, staleTime: 60_000 })
      }
      await printHtmlToPos({
        printerId: job.printerId,
        type: paper.type,
        html: buildDepositReceiptHtml({
          issueDate: job.issueDate,
          staffName: job.staffName,
          amount: job.amount,
          username: job.username,
          methodLabel: job.methodLabel,
          machine: job.machine,
          printerName: printer.printerName,
          note: job.note,
          type: paper.type,
          cafe,
        }),
      })
    },
    [printers, queryClient],
  )

  const run = useCallback(
    async (job: PrintJob) => {
      try {
        await send(job)
        setFailure(null)
        pushToast('Đã gửi phiếu nạp tiền tới máy in.', 'success')
      } catch (failureReason) {
        setFailure({ message: describePrintFailure(failureReason).message, job })
      }
    },
    [send],
  )

  /** Gọi SAU khi nạp thành công. Không bao giờ ném lỗi (tiền đã ghi). */
  const print = useCallback(
    (request: DepositPrintRequest) => {
      if (!available || !enabled || !isPrintableDepositAmount(request.amount)) return
      void run({
        username: request.username,
        amount: request.amount,
        methodLabel: depositMethodLabel(request.method),
        machine: request.machine ?? '',
        // Giờ trình duyệt, chốt một lần — "In lại" dùng đúng giờ này (user chốt 2026-10-14).
        issueDate: formatSystemDateTime(new Date()),
        staffName,
        printerId,
        roomInfo,
        note: note.trim(),
      })
    },
    [available, note, enabled, printerId, roomInfo, run, staffName],
  )

  const retry = async () => {
    if (!failure) return
    setRetrying(true)
    try {
      await run(failure.job)
    } finally {
      setRetrying(false)
    }
  }

  const optionBlock: ReactNode = available ? (
    <PosPrinterPicker
      idPrefix="deposit-print"
      printers={printers}
      printerId={printerId}
      onPrinterChange={(value) => updatePrefs({ printerId: value })}
      roomInfo={roomInfo}
      onRoomInfoChange={(value) => updatePrefs({ roomInfo: value })}
      loading={isLoading}
      errorMessage={isError ? (error as Error).message : undefined}
      inline
      enableLabel="In phiếu nạp tiền"
      enabled={enabled}
      onEnabledChange={(value) => updatePrefs({ enabled: value })}
      note={note}
      onNoteChange={setNoteDraft}
      onNoteCommit={commitNote}
      noteSaving={noteMutation.isPending}
    />
  ) : null

  // Hộp thoại chỉ hiện khi in lỗi — đặt NGOÀI hộp thoại nạp tiền (hộp thoại nạp đã đóng sau khi thành công).
  const retryDialog: ReactNode = (
    <Dialog
      open={failure !== null}
      title="Chưa in được phiếu nạp tiền"
      description="Tiền đã được ghi nhận. Việc in lỗi không ảnh hưởng giao dịch."
      onClose={() => {
        if (!retrying) setFailure(null)
      }}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={retrying} onClick={() => setFailure(null)}>
            Đóng
          </Button>
          <Button type="button" variant="primary" loading={retrying} onClick={() => void retry()}>
            In lại
          </Button>
        </>
      }
    >
      {failure ? <InlineAlert tone="danger">{failure.message}</InlineAlert> : null}
    </Dialog>
  )

  return { available, optionBlock, retryDialog, print }
}
