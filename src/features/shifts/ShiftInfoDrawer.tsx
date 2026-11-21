// task work-shift S2 — Drawer "Thông tin ca": đầu ca, tiền mặt dự kiến, doanh thu theo nguồn × hình thức.
// Chưa có drill-down giao dịch / tab kho (S3) — cố ý không dựng nút chết.
import type { ShiftInfo } from '../../api/shift'
import { Button, Drawer, StateView } from '../../design-system/components'
import { ShiftSummaryTable } from './ShiftSummaryTable'
import { formatMoney, formatShiftDateTime } from './shiftModel'
import { useShiftSummary } from './useShift'
import './shifts.css'

type Props = {
  open: boolean
  shift: ShiftInfo
  onClose: () => void
}

export function ShiftInfoDrawer({ open, shift, onClose }: Props) {
  const summaryQuery = useShiftSummary(shift.shiftId, open)
  const summary = summaryQuery.data

  return (
    <Drawer
      open={open}
      size="wide"
      className="shift-drawer"
      title="Thông tin ca"
      description={`Ca #${shift.shiftId} · ${shift.staffName || 'Nhân viên'}`}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="shift-info">
        <dl className="shift-stats">
          <div>
            <dt>Bắt đầu ca</dt>
            <dd>{formatShiftDateTime(shift.openTime)}</dd>
          </div>
          <div>
            <dt>Tiền mặt đầu ca</dt>
            <dd>{formatMoney(shift.openingCash)}</dd>
          </div>
          <div className="shift-stats__key">
            <dt>Tiền mặt dự kiến hiện tại</dt>
            <dd>{summary ? formatMoney(summary.expectedCash) : '…'}</dd>
          </div>
          <div className="shift-stats__key">
            <dt>Doanh thu ca</dt>
            <dd>{summary ? formatMoney(summary.totals.total) : '…'}</dd>
          </div>
        </dl>

        {summaryQuery.isLoading ? (
          <StateView title="Đang tính doanh thu ca" />
        ) : summaryQuery.isError || !summary ? (
          <StateView
            title="Không tải được tóm tắt ca"
            description={(summaryQuery.error as Error | null)?.message}
            action={<Button onClick={() => void summaryQuery.refetch()}>Thử lại</Button>}
          />
        ) : (
          <ShiftSummaryTable summary={summary} />
        )}
      </div>
    </Drawer>
  )
}
