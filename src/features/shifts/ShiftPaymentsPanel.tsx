// task work-shift S3 (F2) — danh sách giao dịch của một ô (nguồn × hình thức) trong ca; phân trang phía máy chủ, 50 dòng/trang.
import { X } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button, ListPagination, StateView } from '../../design-system/components'
import type { ShiftCellTarget } from './ShiftSummaryTable'
import { PAYMENTS_PAGE_SIZE, methodLabel } from './shiftManageModel'
import { formatShiftDateTime } from './shiftModel'
import { useShiftPayments } from './useShiftManage'
import './shifts.css'

const num = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

type Props = {
  shiftId: number
  target: ShiftCellTarget
  onClear: () => void
}

export function ShiftPaymentsPanel({ shiftId, target, onClear }: Props) {
  // Đổi ô khác ⇒ về trang đầu: `key` ở nơi gọi tạo lại panel nên state `page` tự reset.
  const [page, setPage] = useState(0)
  const source = target.source?.key
  const method = target.method ?? undefined
  const query = useShiftPayments({ shiftId, source, method, page, enabled: true })

  const data = query.data
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAYMENTS_PAGE_SIZE))
  const title = `${target.source?.name ?? 'Mọi nguồn thu'} · ${target.method ? methodLabel(target.method) : 'mọi hình thức'}`

  return (
    <section className="shift-payments" aria-label={`Giao dịch: ${title}`}>
      <header className="shift-payments__head">
        <div>
          <h3 className="shift-payments__title">Giao dịch: {title}</h3>
          <p className="shift-form__hint">
            {data ? `${num(total)} giao dịch` : 'Đang tải…'}
            {target.method === 'deduct' ? ' · Cấn trừ chỉ để xem, không cộng vào doanh thu ca.' : ''}
            {target.method === null ? ' · Danh sách gồm mọi hình thức, kể cả Cấn trừ (không cộng vào Tổng).' : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" icon={<X size={18} weight="bold" aria-hidden="true" />} onClick={onClear}>
          Bỏ chọn
        </Button>
      </header>

      {query.isLoading ? (
        <StateView title="Đang tải giao dịch" />
      ) : query.isError || !data ? (
        <StateView
          title="Không tải được danh sách giao dịch"
          description={(query.error as Error | null)?.message}
          action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
        />
      ) : data.items.length === 0 ? (
        <StateView
          title="Không có giao dịch nào ở ô này"
          action={page > 0 ? <Button onClick={() => setPage(0)}>Về trang đầu</Button> : undefined}
        />
      ) : (
        <>
          {total > PAYMENTS_PAGE_SIZE ? (
            <ListPagination
              page={page}
              totalPages={totalPages}
              canNext={page < totalPages - 1}
              onPrevious={() => setPage((current) => Math.max(0, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          ) : null}
          <div className="shift-table-wrap" role="region" aria-label="Danh sách giao dịch" tabIndex={0}>
            <table className="shift-table">
              <thead>
                <tr>
                  <th scope="col">Mã phiếu</th>
                  <th scope="col">Thời gian</th>
                  <th scope="col">Loại phiếu</th>
                  <th scope="col">Hình thức</th>
                  <th scope="col" className="shift-table__num">Số tiền</th>
                  <th scope="col">Hội viên</th>
                  <th scope="col">Nhân viên</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, index) => (
                  <tr key={`${item.voucherId}-${index}`} className={query.isPlaceholderData ? 'is-stale' : undefined}>
                    <th scope="row">{item.voucherId}</th>
                    <td className="shift-table__nowrap">{formatShiftDateTime(`${item.date} ${item.time}`.trim())}</td>
                    <td>{item.typeName || `Loại ${item.paymentType}`}</td>
                    <td>{methodLabel(item.method)}</td>
                    <td className="shift-table__num">{num(item.amount)}</td>
                    <td>{item.member || '—'}</td>
                    <td>{item.staff || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
