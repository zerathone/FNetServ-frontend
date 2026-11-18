import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getFinished,
  importFinished,
  stocktakeFinished,
  type FinishedImportRow,
  type FinishedStocktakeRow,
} from '../../api/inventory'
import { type ServiceItem } from '../../api/services'
import {
  Button,
  Dialog,
  InlineAlert,
  ListToolbar,
  RefreshButton,
  Segmented,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { pushToast } from '../../store/toast'
import { describeInventoryError, parseWholeNumber } from './inventoryModel'
// Tab này nay nằm ở trang Dịch vụ & hàng hóa (tab Quản lý tồn) — tự nạp CSS .inv-* để không phụ thuộc trang Kho.
import './inventory.css'

const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} đ`
const num = (n: number) => new Intl.NumberFormat('vi-VN').format(n)

/**
 * Tab Quản lý tồn (trang Dịch vụ & hàng hóa): lịch sử phiếu nhập kho + kiểm kê của mặt hàng quản lý tồn.
 * Danh sách mặt hàng và nút Nhập kho / Kiểm kê nằm ở tab Dịch vụ (dùng `ImportDialog` / `StocktakeDialog` bên dưới).
 */
export function FinishedTab() {
  const [history, setHistory] = useState<'imports' | 'stocktakes'>('imports')

  const historyQuery = useQuery({
    queryKey: ['inventory', 'finished', 'history'],
    queryFn: () => getFinished({ limit: 100 }),
  })

  return (
    <div className="inv-stack">
      <section className="inv-panel" aria-label="Lịch sử kho thành phẩm">
        <ListToolbar
          count={<strong>Lịch sử gần đây</strong>}
          actions={
            <>
              <RefreshButton loading={historyQuery.isFetching} onClick={() => void historyQuery.refetch()} />
              <Segmented<'imports' | 'stocktakes'>
                ariaLabel="Loại lịch sử"
                value={history}
                onChange={setHistory}
                options={[
                  { value: 'imports', label: 'Nhập kho' },
                  { value: 'stocktakes', label: 'Kiểm kê' },
                ]}
              />
            </>
          }
        />
        {historyQuery.isLoading ? (
          <StateView title="Đang tải lịch sử…" />
        ) : historyQuery.isError ? (
          <StateView title="Không tải được lịch sử" description={describeInventoryError(historyQuery.error)} />
        ) : historyQuery.data?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có bảng kho thành phẩm" />
        ) : history === 'imports' ? (
          <ImportHistory rows={historyQuery.data?.imports ?? []} />
        ) : (
          <StocktakeHistory rows={historyQuery.data?.stocktakes ?? []} />
        )}
      </section>
    </div>
  )
}
function ImportHistory({ rows }: { rows: FinishedImportRow[] }) {
  if (rows.length === 0) return <StateView title="Chưa có phiếu nhập" />
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>Món</th>
            <th className="is-num">Số lượng</th>
            <th className="is-num">Đơn giá</th>
            <th className="is-num">Thành tiền</th>
            <th>Người nhập</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.createDate} {r.createTime}
              </td>
              <td>{r.serviceName}</td>
              <td className="is-num">
                {num(r.importQuantity)} {r.unit}
              </td>
              <td className="is-num">{money(r.importPrice)}</td>
              <td className="is-num">{money(r.importTotalAmount)}</td>
              <td>{r.userName}</td>
              <td className="inv-muted">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StocktakeHistory({ rows }: { rows: FinishedStocktakeRow[] }) {
  if (rows.length === 0) return <StateView title="Chưa có phiếu kiểm kê" />
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>Món</th>
            <th className="is-num">Tồn trước</th>
            <th className="is-num">Chênh lệch</th>
            <th className="is-num">Tồn sau</th>
            <th>Người kiểm</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.createDate} {r.createTime}
              </td>
              <td>{r.serviceName}</td>
              <td className="is-num">{num(r.numPreAdjust)}</td>
              <td className="is-num">
                <StatusBadge tone={r.numAdjust < 0 ? 'danger' : r.numAdjust > 0 ? 'warning' : 'neutral'} dot={false}>
                  {r.numAdjust > 0 ? `+${num(r.numAdjust)}` : num(r.numAdjust)}
                </StatusBadge>
              </td>
              <td className="is-num">{num(r.numInventoryReal)}</td>
              <td>{r.userName}</td>
              <td className="inv-muted">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Dùng chung với danh sách Dịch vụ & hàng hóa (nút Nhập kho ở dòng mặt hàng có quản lý tồn). */
export function ImportDialog({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { getKey, clearKey } = useIdempotentIntent('fin-import')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (service) {
      setQty('')
      setPrice('')
      setNote('')
      clearKey()
    }
  }, [service, clearKey])

  const q = parseWholeNumber(qty)
  const p = parseWholeNumber(price)
  const total = q !== null && p !== null ? q * p : null
  const valid = service !== null && q !== null && q > 0 && q <= 1_000_000 && p !== null && total !== null && total <= 999_999_999

  const mutation = useMutation({
    mutationFn: () => {
      if (!service || q === null || p === null) throw new Error('Dữ liệu chưa hợp lệ.')
      const body = { serviceId: service.id, quantity: q, price: p, note: note.trim() || undefined }
      // Cùng nội dung ⇒ cùng idem: bấm lại sau timeout không nhập đôi.
      return importFinished({ ...body, idem: getKey(JSON.stringify(body)) })
    },
    onSuccess: (result) => {
      clearKey()
      pushToast(
        `Đã nhập kho: ${num(result.inventoryBefore)} → ${num(result.inventoryAfter)}${result.duplicated ? ' (phiếu đã ghi trước đó)' : ''}.`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['services'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'finished'] })
      onClose()
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  if (!service) return null
  return (
    <Dialog
      open
      title={`Nhập kho — ${service.name}`}
      description={`Tồn hiện tại ${num(service.inventory)} ${service.unit}`.trim()}
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" variant="primary" loading={mutation.isPending} disabled={!valid} onClick={() => mutation.mutate()}>
            Ghi phiếu nhập
          </Button>
        </>
      }
    >
      <div className="inv-form">
        <label className="ds-field">
          <span className="ds-field__label">Số lượng nhập {service.unit ? `(${service.unit})` : ''}</span>
          <input className="ds-input" inputMode="numeric" value={qty} autoFocus onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Đơn giá nhập (đ)</span>
          <input className="ds-input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <div className="ds-field">
          <span className="ds-field__label">Tổng tiền</span>
          <span className="inv-form__static" title="Số lượng × đơn giá; máy chủ tính lại, không tin số này.">
            {total === null ? '—' : money(total)}
          </span>
        </div>
        <label className="ds-field">
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
        </label>
        {total !== null && total > 999_999_999 ? (
          <div className="inv-form__wide">
            <InlineAlert tone="danger">Tổng tiền vượt giới hạn 999.999.999 đ.</InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

/** Dùng chung với danh sách Dịch vụ & hàng hóa (nút Kiểm kê ở dòng mặt hàng có quản lý tồn). */
export function StocktakeDialog({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { getKey, clearKey } = useIdempotentIntent('fin-stktk')
  // Nhập số đếm thực tế; chênh lệch = thực tế − tồn, tự tính (server vẫn tính lại từ numReal).
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (service) {
      setValue('')
      setNote('')
      clearKey()
    }
  }, [service, clearKey])

  const parsed = parseWholeNumber(value, false)
  const diff = service && parsed !== null ? parsed - service.inventory : null
  const valid = service !== null && parsed !== null && parsed >= 0 && parsed <= 1_000_000

  const mutation = useMutation({
    mutationFn: () => {
      if (!service || parsed === null) throw new Error('Dữ liệu chưa hợp lệ.')
      const body = { serviceId: service.id, numReal: parsed, note: note.trim() || undefined }
      return stocktakeFinished({ ...body, idem: getKey(JSON.stringify(body)) })
    },
    onSuccess: (result) => {
      clearKey()
      pushToast(
        `Đã kiểm kê: ${num(result.numPreAdjust)} → ${num(result.numInventoryReal)} (lệch ${result.numAdjust > 0 ? '+' : ''}${num(result.numAdjust)}).`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['services'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'finished'] })
      onClose()
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  if (!service) return null
  return (
    <Dialog
      open
      title={`Kiểm kê — ${service.name}`}
      description={`Tồn hiện tại ${num(service.inventory)} ${service.unit}`.trim()}
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" variant="primary" loading={mutation.isPending} disabled={!valid} onClick={() => mutation.mutate()}>
            Ghi phiếu kiểm kê
          </Button>
        </>
      }
    >
      <div className="inv-form">
        <div className="ds-field">
          <span className="ds-field__label">Số lượng tồn</span>
          <span className="inv-form__static">
            {num(service.inventory)} {service.unit}
          </span>
        </div>
        <label className="ds-field">
          <span className="ds-field__label">Số lượng thực tế</span>
          <input
            className="ds-input"
            inputMode="numeric"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="ds-field">
          <span className="ds-field__label">Chênh lệch</span>
          <span className="inv-form__static">
            {diff === null ? (
              '—'
            ) : diff === 0 ? (
              <StatusBadge tone="success" dot>
                Cân bằng
              </StatusBadge>
            ) : (
              <StatusBadge tone={diff < 0 ? 'danger' : 'warning'} dot>
                {diff > 0 ? '+' : ''}
                {num(diff)} {service.unit}
              </StatusBadge>
            )}
          </span>
        </div>
        <label className="ds-field">
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Dialog>
  )
}
