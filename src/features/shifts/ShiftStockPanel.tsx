// task work-shift S3 (F2) — kho nguyên liệu của ca: Đầu ca / Cuối ca (hoặc hiện tại) / Chênh lệch + phân rã nhập · xuất · điều chỉnh.
// Kho là MỘT bể chung vật lý (design mục 8): các ca chồng giờ cùng thấy biến động — nói rõ trên giao diện.
import { Button, InlineAlert, StateView } from '../../design-system/components'
import type { ShiftStockResult } from '../../api/shift'
import { formatQty, formatSignedQty } from './shiftManageModel'
import './shifts.css'

type Props = {
  /** Ca còn mở ⇒ cột "Cuối ca" thành "Hiện tại" (tồn kho đang có). */
  isOpen: boolean
  isLoading: boolean
  error: Error | null
  data: ShiftStockResult | undefined
  onRetry: () => void
}

export function ShiftStockPanel({ isOpen, isLoading, error, data, onRetry }: Props) {
  return (
    <div className="shift-stock">
      <InlineAlert tone="info">
        Kho là bể chung — các ca chồng giờ cùng thấy biến động của nhau. Số tin cậy là Đầu ca và {isOpen ? 'Hiện tại' : 'Cuối ca'}.
      </InlineAlert>
      {data && !data.openSnapshot ? (
        <InlineAlert tone="warning">
          Ca này không có ảnh chụp tồn kho lúc mở ca, nên cột Đầu ca và Chênh lệch để trống.
        </InlineAlert>
      ) : null}
      {data && !isOpen && !data.closeSnapshot ? (
        <InlineAlert tone="warning">Ca này không có ảnh chụp tồn kho lúc chốt ca, nên cột Cuối ca không đáng tin.</InlineAlert>
      ) : null}
      {isLoading ? (
        <StateView title="Đang tải tồn kho của ca" />
      ) : error || !data ? (
        <StateView
          title="Không tải được tồn kho của ca"
          description={error?.message}
          action={<Button onClick={onRetry}>Thử lại</Button>}
        />
      ) : data.rows.length === 0 ? (
        <StateView title="Ca này chưa có dữ liệu kho" description="Chưa chụp tồn kho đầu ca hoặc không có nguyên liệu đang bán." />
      ) : (
        <div className="shift-table-wrap" role="region" aria-label="Tồn kho nguyên liệu theo ca" tabIndex={0}>
          <table className="shift-table">
            <thead>
              <tr>
                <th scope="col">Nguyên liệu</th>
                <th scope="col">Đơn vị</th>
                <th scope="col" className="shift-table__num">Đầu ca</th>
                <th scope="col" className="shift-table__num">{isOpen ? 'Hiện tại' : 'Cuối ca'}</th>
                <th scope="col" className="shift-table__num">Chênh lệch</th>
                <th scope="col" className="shift-table__num">Nhập</th>
                <th scope="col" className="shift-table__num">Xuất</th>
                <th scope="col" className="shift-table__num">Điều chỉnh</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.materialId}>
                  <th scope="row">{row.name || `Nguyên liệu #${row.materialId}`}</th>
                  <td>{row.unit || '—'}</td>
                  <td className="shift-table__num">{row.open === null ? '—' : formatQty(row.open)}</td>
                  <td className="shift-table__num">{formatQty(row.close)}</td>
                  <td className="shift-table__num shift-table__total">{row.delta === null ? '—' : formatSignedQty(row.delta)}</td>
                  <td className="shift-table__num">{formatQty(row.imported)}</td>
                  <td className="shift-table__num">{formatQty(row.exported)}</td>
                  <td className="shift-table__num">{formatSignedQty(row.adjusted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
