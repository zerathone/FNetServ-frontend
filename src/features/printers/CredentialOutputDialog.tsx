import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getPrinters, printBitmap } from '../../api/printer'
import { Button, Dialog, InlineAlert, Select, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { renderPrinterHtml } from './browserHtmlRaster'
import {
  buildCredentialPrintHtml,
  credentialTitle,
  formatCredentialText,
  type PrintableCredential,
} from './credentialPrintModel'
import './credential-print.css'

type OutputType = 'a4' | '1' | '2'

type Props = {
  open: boolean
  records: PrintableCredential[]
  skipped?: string[]
  sourceLabel?: string
  onClose: () => void
}

function downloadText(records: PrintableCredential[]) {
  const today = new Date().toISOString().slice(0, 10)
  const kind = records[0]?.kind === 'member' ? 'hoi-vien' : 'the-nap'
  const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), formatCredentialText(records)], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${kind}-${today}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}

function printA4(records: PrintableCredential[]) {
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
  page.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>In thông tin</title></head><body>${buildCredentialPrintHtml(records, true)}</body></html>`)
  page.close()
  const removeFrame = () => frame.remove()
  frame.contentWindow.onafterprint = removeFrame
  window.setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(removeFrame, 60_000)
  }, 150)
}

export function CredentialOutputDialog({
  open,
  records,
  skipped = [],
  sourceLabel,
  onClose,
}: Props) {
  const [outputType, setOutputType] = useState<OutputType>('a4')
  const [printerId, setPrinterId] = useState(0)
  const printersQuery = useQuery({
    queryKey: ['printers', 'credential-output'],
    queryFn: getPrinters,
    enabled: open,
  })
  const posType = outputType === '1' ? 1 : outputType === '2' ? 2 : null
  const matchingPrinters = useMemo(
    () => (printersQuery.data ?? []).filter(
      (printer) => printer.active === 1 && printer.type === posType && Boolean(printer.printerId),
    ),
    [posType, printersQuery.data],
  )

  useEffect(() => {
    if (!open || !posType) return
    if (!matchingPrinters.some((printer) => printer.printerId === printerId)) {
      setPrinterId(matchingPrinters[0]?.printerId ?? 0)
    }
  }, [matchingPrinters, open, posType, printerId])

  const printMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!records.length) throw new Error('Không có dữ liệu để in.')
      if (outputType === 'a4') {
        printA4(records)
        return { sent: records.length, a4: true }
      }
      if (!printerId || !posType) throw new Error('Hãy chọn máy in POS đang hoạt động.')

      let sent = 0
      const chunkSize = 6
      for (let index = 0; index < records.length; index += chunkSize) {
        const chunk = records.slice(index, index + chunkSize)
        try {
          const bitmap = await renderPrinterHtml(
            printerId,
            posType,
            buildCredentialPrintHtml(chunk),
          )
          if (bitmap.height > 4096) {
            throw new Error('Mẫu in vượt giới hạn 4.096 dòng.')
          }
          await printBitmap(bitmap)
          sent += chunk.length
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Không gửi được lệnh in.'
          throw new Error(`${message} Đã gửi ${sent}/${records.length} mục trước khi dừng.`)
        }
      }
      return { sent, a4: false }
    },
    onSuccess: ({ sent, a4 }) => {
      pushToast(
        a4 ? 'Đã mở hộp thoại in A4 của trình duyệt.' : `Đã gửi ${sent} mục tới máy in POS.`,
        'success',
      )
    },
    onError: (error: Error) => pushToast(
      `${error.message} Không tự gửi lại; hãy kiểm tra máy in và danh sách trước khi thử lại.`,
      'error',
    ),
  })

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(formatCredentialText(records))
      pushToast('Đã sao chép dữ liệu.', 'success')
    } catch {
      pushToast('Không thể truy cập clipboard. Hãy tải file thay thế.', 'error')
    }
  }

  const kind = records[0]?.kind ?? 'voucher'
  const close = () => {
    if (!printMutation.isPending) onClose()
  }

  return (
    <Dialog
      open={open}
      title={`${credentialTitle(kind)} · ${records.length} mục`}
      description={sourceLabel ?? 'Mã bí mật chỉ hiển thị trong phiên làm việc hiện tại.'}
      size="lg"
      onClose={close}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => void copyText()}>
            Sao chép
          </Button>
          <Button type="button" variant="secondary" onClick={() => downloadText(records)}>
            Tải file .txt
          </Button>
          <Button type="button" variant="primary" disabled={!records.length} onClick={close}>
            Đã lưu, đóng
          </Button>
        </>
      }
    >
      <div className="credential-output">
        {skipped.length ? (
          <InlineAlert tone="warning">
            Đã bỏ qua {skipped.length} tên đã tồn tại: {skipped.slice(0, 8).join(', ')}
            {skipped.length > 8 ? '…' : ''}
          </InlineAlert>
        ) : null}

        <div className="credential-output__controls">
          <label className="ds-field">
            <span className="ds-field__label">Khổ in</span>
            <Select value={outputType} onChange={(event) => setOutputType(String(event.target.value) as OutputType)}>
              <option value="a4">A4 · trình duyệt</option>
              <option value="2">POS 58 mm</option>
              <option value="1">POS 80 mm</option>
            </Select>
          </label>
          {posType ? (
            <label className="ds-field">
              <span className="ds-field__label">Máy in POS</span>
              <Select value={printerId} disabled={printersQuery.isLoading} onChange={(event) => setPrinterId(Number(event.target.value))}>
                {matchingPrinters.length ? matchingPrinters.map((printer) => (
                  <option key={printer.printerId} value={printer.printerId}>{printer.printerName}</option>
                )) : <option value={0}>Không có máy phù hợp</option>}
              </Select>
            </label>
          ) : null}
          <Button
            type="button"
            variant="primary"
            loading={printMutation.isPending}
            disabled={posType !== null && (!printerId || printersQuery.isLoading)}
            onClick={() => printMutation.mutate()}
          >
            {outputType === 'a4' ? 'Mở bản in A4' : 'Gửi tới máy in'}
          </Button>
        </div>

        {printersQuery.isError && posType ? (
          <StateView
            title="Không tải được danh sách máy in"
            description={(printersQuery.error as Error).message}
            action={<Button onClick={() => void printersQuery.refetch()}>Thử lại</Button>}
          />
        ) : null}

        <div className="credential-output__preview" aria-label="Xem trước dữ liệu">
          {records.slice(0, 12).map((record, index) => (
            <article key={record.kind === 'member' ? record.username : `${record.id ?? index}-${record.code}`}>
              <span>{record.kind === 'member' ? `Tài khoản ${index + 1}` : `Thẻ ${index + 1}`}</span>
              <strong>{record.kind === 'member' ? record.username : record.code}</strong>
              <small>
                {record.kind === 'member'
                  ? `Mật khẩu: ${record.password}`
                  : `${record.value.toLocaleString('vi-VN')} đ · ${record.walletType === 0 ? 'Ví chính' : 'Ví khuyến mãi'}`}
              </small>
            </article>
          ))}
        </div>
        {records.length > 12 ? <p className="credential-output__more">Và {records.length - 12} mục khác.</p> : null}
      </div>
    </Dialog>
  )
}
