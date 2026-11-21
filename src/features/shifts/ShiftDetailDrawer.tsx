// task work-shift S3 (F2) — Drawer chi tiết một ca (trang quản lý /shifts). Tabs bằng Segmented:
// Tổng quan · Doanh thu (bấm ô ⇒ giao dịch) · Hoàn tiền · Kho (ẩn khi máy chủ không có bảng kho) · Đặt máy (tham khảo).
import { Lock, Warning } from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import type { ShiftListItem, ShiftSummary } from '../../api/shift'
import {
  Button,
  Drawer,
  InlineAlert,
  Segmented,
  StateView,
  StatusBadge,
  type SegmentedOption,
} from '../../design-system/components'
import { ForceCloseDialog } from './ForceCloseDialog'
import { ShiftPaymentsPanel } from './ShiftPaymentsPanel'
import { ShiftPrintSection } from './ShiftPrintSection'
import { ShiftStockPanel } from './ShiftStockPanel'
import { ShiftSummaryTable, type ShiftCellTarget } from './ShiftSummaryTable'
import { cashDiffView, listItemToCloseResult, shiftStatusView } from './shiftManageModel'
import { formatMoney, formatShiftDateTime } from './shiftModel'
import { useShiftSummary } from './useShift'
import { useShiftStock } from './useShiftManage'
import './shifts.css'

type TabId = 'overview' | 'revenue' | 'refund' | 'stock' | 'booking'

type Props = {
  /** null = đóng Drawer. */
  shift: ShiftListItem | null
  canForceClose: boolean
  onClose: () => void
}

export function ShiftDetailDrawer({ shift, canForceClose, onClose }: Props) {
  // `key` theo ca: đổi ca khác ⇒ tab, ô đang chọn, hộp thoại đều về trạng thái đầu. Làm mới danh sách (cùng shiftId) thì giữ nguyên.
  if (!shift) return null
  return <DrawerBody key={shift.shiftId} shift={shift} canForceClose={canForceClose} onClose={onClose} />
}

function DrawerBody({ shift, canForceClose, onClose }: Omit<Props, 'shift'> & { shift: ShiftListItem }) {
  const [tab, setTab] = useState<TabId>('overview')
  const [cell, setCell] = useState<ShiftCellTarget | null>(null)
  const [forceOpen, setForceOpen] = useState(false)

  const isOpenShift = shift.status === 1
  const summaryQuery = useShiftSummary(shift.shiftId, true, isOpenShift)
  const stockQuery = useShiftStock(shift.shiftId, true)
  const summary = summaryQuery.data ?? null
  const status = shiftStatusView(shift)
  const diff = cashDiffView(shift.cashDiff, shift.status)

  // Tab Kho ẩn khi máy chủ báo không có bảng kho (khách chưa dùng kho nguyên liệu) — không lỗi, không tab chết.
  const stockHidden = stockQuery.data?.available === false
  const options = useMemo<SegmentedOption<TabId>[]>(
    () => [
      { value: 'overview', label: 'Tổng quan' },
      { value: 'revenue', label: 'Doanh thu' },
      { value: 'refund', label: 'Hoàn tiền' },
      ...(stockHidden ? [] : [{ value: 'stock' as const, label: 'Kho' }]),
      { value: 'booking', label: 'Đặt máy' },
    ],
    [stockHidden],
  )
  const activeTab: TabId = tab === 'stock' && stockHidden ? 'overview' : tab

  const summaryFallback = (render: (summary: ShiftSummary) => ReactNode) =>
    summaryQuery.isLoading ? (
      <StateView title="Đang tính doanh thu ca" />
    ) : summaryQuery.isError || !summary ? (
      <StateView
        title="Không tải được tóm tắt ca"
        description={(summaryQuery.error as Error | null)?.message}
        action={<Button onClick={() => void summaryQuery.refetch()}>Thử lại</Button>}
      />
    ) : (
      render(summary)
    )

  const refundsQr = summary?.refundsQrCanceled ?? null
  const bookings = summary?.onlineBook ?? null

  return (
    <>
      <Drawer
        open
        size="wide"
        className="shift-drawer"
        title={`Ca #${shift.shiftId}`}
        description={`${shift.staffName || 'Nhân viên'} · ${status.label}`}
        // Hộp thoại Đóng cưỡng bức đang mở: Esc thuộc về hộp thoại đó, không đóng luôn Drawer phía sau.
        onClose={() => {
          if (!forceOpen) onClose()
        }}
        footer={
          <>
            {canForceClose ? (
              <Button
                type="button"
                variant="danger-outline"
                className="shift-drawer__force"
                icon={<Lock size={18} weight="bold" aria-hidden="true" />}
                onClick={() => setForceOpen(true)}
              >
                Đóng cưỡng bức
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
          </>
        }
      >
        <div className="shift-info">
          <Segmented<TabId> ariaLabel="Chi tiết ca" value={activeTab} options={options} onChange={setTab} />

          {activeTab === 'overview' ? (
            <div className="shift-info">
              {shift.hung ? (
                <InlineAlert tone="warning">
                  <span className="shift-inline-icon">
                    <Warning size={18} weight="fill" aria-hidden="true" />
                    Ca này đã mở quá 16 giờ nên được coi là treo (có thể nhân viên quên chốt ca).
                    {canForceClose ? ' Bạn có thể đóng cưỡng bức ở góc dưới.' : ''}
                  </span>
                </InlineAlert>
              ) : null}
              {refundsQr && refundsQr.count > 0 ? (
                <InlineAlert tone="warning">
                  <span className="shift-inline-icon">
                    <Warning size={18} weight="fill" aria-hidden="true" />
                    <span>
                      Có {refundsQr.count} đơn QR đã thu tiền bị hủy ({formatMoney(refundsQr.total)}) — cần hoàn khách.{' '}
                      <button type="button" className="shift-widget__retry" onClick={() => setTab('refund')}>
                        Xem ở tab Hoàn tiền
                      </button>
                    </span>
                  </span>
                </InlineAlert>
              ) : null}

              <dl className="shift-stats">
                <div>
                  <dt>Nhân viên</dt>
                  <dd>{shift.staffName || '—'}</dd>
                </div>
                <div>
                  <dt>Trạng thái</dt>
                  <dd>
                    <StatusBadge tone={status.tone} title={status.hint}>
                      {status.label}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt>Mở ca</dt>
                  <dd>{formatShiftDateTime(shift.openTime)}</dd>
                </div>
                <div>
                  <dt>Chốt ca</dt>
                  <dd>{shift.closeTime ? formatShiftDateTime(shift.closeTime) : 'Chưa chốt'}</dd>
                </div>
                <div>
                  <dt>Tiền mặt đầu ca</dt>
                  <dd>{formatMoney(shift.openingCash)}</dd>
                </div>
                <div>
                  <dt>{isOpenShift ? 'Tiền mặt dự kiến hiện tại' : 'Tiền mặt dự kiến'}</dt>
                  <dd>
                    {shift.expectedCash !== null
                      ? formatMoney(shift.expectedCash)
                      : summary
                        ? formatMoney(summary.expectedCash)
                        : '…'}
                  </dd>
                </div>
                <div>
                  <dt>Tiền thực đếm</dt>
                  <dd>{shift.countedCash === null ? 'Không nhập' : formatMoney(shift.countedCash)}</dd>
                </div>
                <div className="shift-stats__key">
                  <dt>Chênh lệch tiền mặt</dt>
                  <dd className={diff.kind === 'ok' ? 'is-ok' : diff.kind === 'short' ? 'is-short' : diff.kind === 'over' ? 'is-over' : ''}>
                    {diff.text}
                  </dd>
                </div>
                <div className="shift-stats__key">
                  <dt>Doanh thu ca</dt>
                  <dd>{formatMoney(shift.revenue)}</dd>
                </div>
              </dl>

              {!isOpenShift ? (
                <>
                  <h3 className="shift-section-title">In phiếu ca</h3>
                  {summaryQuery.isLoading ? (
                    <p className="shift-form__hint">Đang tải số liệu để in…</p>
                  ) : !summary ? (
                    // Không có tóm tắt thì phiếu thiếu doanh thu theo hình thức — không cho in phiếu thiếu mà không báo.
                    <InlineAlert tone="warning">
                      Chưa tải được tóm tắt ca nên chưa in được phiếu.{' '}
                      <Button type="button" variant="ghost" onClick={() => void summaryQuery.refetch()}>
                        Thử lại
                      </Button>
                    </InlineAlert>
                  ) : (
                    <ShiftPrintSection result={listItemToCloseResult(shift, summary)} />
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'revenue'
            ? summaryFallback((data) => (
                <>
                  <ShiftSummaryTable summary={data} onCellClick={setCell} />
                  {cell ? (
                    <ShiftPaymentsPanel
                      key={`${cell.source?.key ?? '*'}|${cell.method ?? '*'}`}
                      shiftId={shift.shiftId}
                      target={cell}
                      onClear={() => setCell(null)}
                    />
                  ) : null}
                </>
              ))
            : null}

          {activeTab === 'refund'
            ? summaryFallback((data) => (
                <div className="shift-info">
                  <dl className="shift-stats">
                    <div>
                      <dt>Số lượt hoàn tiền</dt>
                      <dd>{data.refund.count}</dd>
                    </div>
                    <div>
                      <dt>Đã hoàn bằng tiền mặt</dt>
                      <dd>{formatMoney(Math.abs(data.refund.cash))}</dd>
                    </div>
                    <div>
                      <dt>Đã hoàn bằng chuyển khoản</dt>
                      <dd>{formatMoney(Math.abs(data.refund.online))}</dd>
                    </div>
                  </dl>
                  <p className="shift-form__hint">Hoàn tiền (số âm) đã được trừ sẵn trong doanh thu các nguồn ở tab Doanh thu.</p>
                  {data.refundsQrCanceled ? (
                    data.refundsQrCanceled.count > 0 ? (
                      <InlineAlert tone="warning">
                        <strong>Đơn QR đã thu bị hủy — cần hoàn khách</strong>
                        <p className="shift-form__hint">
                          {data.refundsQrCanceled.count} đơn, tổng {formatMoney(data.refundsQrCanceled.total)}. Tiền đã vào
                          ngân hàng nhưng đơn bị hủy; hệ thống không tự hoàn nên cần hoàn khách ngoài hệ thống.
                        </p>
                      </InlineAlert>
                    ) : (
                      <p className="shift-form__hint">Không có đơn QR đã thu bị hủy trong ca này.</p>
                    )
                  ) : null}
                </div>
              ))
            : null}

          {activeTab === 'stock' ? (
            <ShiftStockPanel
              isOpen={isOpenShift}
              isLoading={stockQuery.isLoading}
              error={stockQuery.isError ? (stockQuery.error as Error) : null}
              data={stockQuery.data}
              onRetry={() => void stockQuery.refetch()}
            />
          ) : null}

          {activeTab === 'booking'
            ? summaryFallback(() => (
                <div className="shift-info">
                  <InlineAlert tone="info">Tham khảo — không cộng vào doanh thu ca.</InlineAlert>
                  {bookings ? (
                    <dl className="shift-stats">
                      <div>
                        <dt>Số đơn đặt máy do chủ ca duyệt hoặc đặt hộ</dt>
                        <dd>{bookings.count}</dd>
                      </div>
                      <div>
                        <dt>Tổng tiền trừ ví</dt>
                        <dd>{formatMoney(bookings.walletTotal)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="shift-form__hint">Máy chủ chưa trả số liệu đặt máy cho ca này.</p>
                  )}
                  <p className="shift-form__hint">
                    Phần đặt máy trả bằng QR đã nằm trong doanh thu “Nạp hội viên” ở tab Doanh thu.
                  </p>
                </div>
              ))
            : null}
        </div>
      </Drawer>

      {forceOpen ? (
        <ForceCloseDialog
          shift={shift}
          onCancel={() => setForceOpen(false)}
          // Giữ Drawer mở để quản lý thấy ca đã sang "Đóng cưỡng bức" (danh sách + tóm tắt vừa được làm mới).
          onDone={() => setForceOpen(false)}
        />
      ) : null}
    </>
  )
}
