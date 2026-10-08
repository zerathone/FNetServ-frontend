// task staff-service-order (FE-2) — nút "In phiếu" theo đơn. Server KHÔNG dựng ESC/POS: BE-2 chỉ trả định
// tuyến (máy in nào nhận món nào); phiếu render ở browser (`browserHtmlRaster`) rồi gửi bitmap qua
// `/printer/print` có sẵn. Chỉ in khi người dùng bấm (Qt đã tự in sau accept/pay, chưa có cờ "đã in").
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from '@phosphor-icons/react'
import { getPrintTargets, type PrintTargetPrinter } from '../../api/orders'
import { printBitmap } from '../../api/printer'
import { Button, Dialog, InlineAlert, StateView, StatusBadge } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { renderPrinterHtml } from '../printers/browserHtmlRaster'
import {
  MAX_TICKET_ROWS,
  buildServiceTicketHtml,
  jobStateOf,
  printerPaper,
  splitPrinters,
  ticketCustomerLabel,
  ticketHostLabel,
  ticketTotal,
  type PrinterJobState,
} from './printTicketModel'

type Props = {
  /** `null` = đóng. Luôn là `detailId` của ĐÚNG phiếu/thẻ cần in (vãng lai dùng chung userId nên không gửi cả nhóm). */
  detailIds: number[] | null
  onClose: () => void
}

const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`

export function PrintTicketDialog({ detailIds, onClose }: Props) {
  const open = detailIds !== null
  const idsKey = detailIds ? [...detailIds].sort((left, right) => left - right).join(',') : ''
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [jobs, setJobs] = useState<Record<number, PrinterJobState>>({})

  const targetsQuery = useQuery({
    queryKey: ['print-targets', idsKey],
    queryFn: () => getPrintTargets({ detailIds: detailIds ?? [] }),
    enabled: open && idsKey !== '',
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const targets = targetsQuery.data
  const split = useMemo(() => (targets ? splitPrinters(targets) : null), [targets])

  // Mặc định chọn mọi máy in được; mở phiếu khác ⇒ xoá trạng thái in cũ.
  useEffect(() => {
    setJobs({})
    setSelected(new Set(split?.printable.map((printer) => printer.printerId) ?? []))
  }, [split, idsKey])

  const printing = Object.values(jobs).some((job) => job.status === 'printing')

  const printOne = async (printer: PrintTargetPrinter) => {
    if (!targets) return
    const paper = printerPaper(printer.type)
    if (!paper) throw new Error('Máy in không phải khổ POS 58/80.')
    const html = buildServiceTicketHtml({
      header: targets.header,
      printerName: printer.name,
      items: printer.items,
      type: paper.type,
    })
    const bitmap = await renderPrinterHtml(printer.printerId, paper.type, html)
    if (bitmap.height > MAX_TICKET_ROWS) throw new Error('Phiếu vượt giới hạn 4.096 dòng.')
    await printBitmap(bitmap)
  }

  // Gửi SONG SONG: máy in offline giữ 1 luồng HTTP ~6 giây (kết nối 3 giây × 2 lần) ⇒ tuần tự N máy = treo
  // N×6 giây. KHÔNG tự thử lại (PLAN_2.11: in lỗi không rollback tiền) — chỉ cho bấm lại từng máy.
  const printMany = async (printers: PrintTargetPrinter[]) => {
    if (printers.length === 0) return
    setJobs((current) => {
      const next = { ...current }
      printers.forEach((printer) => {
        next[printer.printerId] = { status: 'printing' }
      })
      return next
    })
    const results = await Promise.allSettled(printers.map((printer) => printOne(printer)))
    setJobs((current) => {
      const next = { ...current }
      results.forEach((result, index) => {
        next[printers[index].printerId] = jobStateOf(result)
      })
      return next
    })
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed === 0) pushToast(`Đã gửi phiếu tới ${printers.length} máy in.`, 'success')
    else pushToast(`${failed}/${printers.length} máy in lỗi — xem chi tiết trong hộp thoại.`, 'error')
  }

  const toggle = (printerId: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(printerId)) next.delete(printerId)
      else next.add(printerId)
      return next
    })

  const selectedPrinters = (split?.printable ?? []).filter((printer) => selected.has(printer.printerId))
  const close = () => {
    if (!printing) onClose()
  }

  return (
    <Dialog
      open={open}
      title="In phiếu dịch vụ"
      description="Gửi phiếu tới máy in bếp/quầy được gán cho từng món."
      size="lg"
      onClose={close}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={printing} onClick={close}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={<Printer {...actionIconProps} />}
            loading={printing}
            disabled={selectedPrinters.length === 0}
            onClick={() => void printMany(selectedPrinters)}
          >
            In {selectedPrinters.length > 0 ? `${selectedPrinters.length} máy đã chọn` : 'phiếu'}
          </Button>
        </>
      }
    >
      <div className="staff-order">
        {targetsQuery.isLoading ? (
          <StateView title="Đang tra máy in cho phiếu" />
        ) : targetsQuery.isError ? (
          <StateView
            title="Không tra được máy in của phiếu"
            description={(targetsQuery.error as Error).message}
            action={<Button onClick={() => void targetsQuery.refetch()}>Thử lại</Button>}
          />
        ) : targets && split ? (
          <>
            <dl className="order-confirm-summary">
              <div><dt>Máy</dt><dd>{ticketHostLabel(targets.header)}</dd></div>
              <div><dt>Khách</dt><dd>{ticketCustomerLabel(targets.header)}</dd></div>
              {targets.header.voucherId > 0 ? (
                <div><dt>Phiếu</dt><dd>#{targets.header.voucherId}</dd></div>
              ) : null}
            </dl>

            {split.printable.length === 0 ? (
              <p className="staff-order__hint">Không có máy in nào in được từ Web cho các món của phiếu này.</p>
            ) : (
              <ul className="staff-order__printers" aria-label="Máy in nhận phiếu">
                {split.printable.map((printer) => {
                  const job = jobs[printer.printerId] ?? { status: 'idle' as const }
                  const paper = printerPaper(printer.type)
                  return (
                    <li key={printer.printerId} className="staff-order__printer">
                      <label className="staff-order__printer-head">
                        <input
                          type="checkbox"
                          checked={selected.has(printer.printerId)}
                          disabled={printing}
                          onChange={() => toggle(printer.printerId)}
                        />
                        <strong>{printer.name}</strong>
                        <small>
                          {paper?.label} · {printer.items.length} món · {money(ticketTotal(printer.items))}
                        </small>
                      </label>
                      <small className="staff-order__printer-items">
                        {printer.items.map((item) => `${item.serviceName} × ${item.quantity}`).join(', ')}
                      </small>
                      <div className="staff-order__printer-state">
                        {job.status === 'printing' ? <StatusBadge tone="info">Đang gửi…</StatusBadge> : null}
                        {job.status === 'done' ? <StatusBadge tone="success">Đã gửi</StatusBadge> : null}
                        {job.status === 'failed' ? (
                          <>
                            <StatusBadge tone="danger">Lỗi</StatusBadge>
                            <small>{job.message}</small>
                          </>
                        ) : null}
                        {job.status === 'failed' || job.status === 'done' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={printing}
                            onClick={() => void printMany([printer])}
                          >
                            {job.status === 'failed' ? 'In lại máy này' : 'In thêm'}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {split.unsupported.length > 0 ? (
              <InlineAlert tone="warning">
                <strong>Máy in không hỗ trợ in từ Web</strong>
                <ul className="staff-order__plain-list">
                  {split.unsupported.map(({ printer, reason }) => (
                    <li key={printer.printerId}>
                      {printer.name}: {printer.items.map((item) => item.serviceName).join(', ')} — {reason}
                    </li>
                  ))}
                </ul>
              </InlineAlert>
            ) : null}

            {targets.unrouted.length > 0 ? (
              <InlineAlert tone="info">
                <strong>Không có máy in nhận món:</strong>{' '}
                {targets.unrouted.map((item) => `${item.serviceName} × ${item.quantity}`).join(', ')}.
              </InlineAlert>
            ) : null}

            {targets.notFound.length > 0 ? (
              <InlineAlert tone="warning">
                {targets.notFound.length} dòng không còn trong hệ thống (đã bị xóa hoặc hủy) nên không có trong
                phiếu.
              </InlineAlert>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  )
}
