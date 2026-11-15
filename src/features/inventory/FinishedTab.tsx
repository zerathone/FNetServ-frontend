import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import {
  getFinished,
  importFinished,
  stocktakeFinished,
  type FinishedImportRow,
  type FinishedStocktakeRow,
} from '../../api/inventory'
import { getServices, type ServiceItem } from '../../api/services'
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
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { describeInventoryError, parseWholeNumber } from './inventoryModel'

const money = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)} đ`
const num = (n: number) => new Intl.NumberFormat('vi-VN').format(n)

type Dialog_ = { kind: 'import' | 'stocktake'; service: ServiceItem } | null

/** Tab Kho thành phẩm: món có InventoryManagement=1 (tồn là số nguyên), nhập kho + kiểm kê + lịch sử. */
export function FinishedTab() {
  const hasRight = useAuthStore((s) => s.hasRight)
  const canImport = hasRight(64)
  const canStocktake = hasRight(68)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<Dialog_>(null)
  const [history, setHistory] = useState<'imports' | 'stocktakes'>('imports')

  const servicesQuery = useQuery({ queryKey: ['services'], queryFn: getServices })
  const historyQuery = useQuery({
    queryKey: ['inventory', 'finished', 'history'],
    queryFn: () => getFinished({ limit: 100 }),
  })

  const managed = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    return (servicesQuery.data ?? []).filter(
      (s) => s.inventoryManagement === 1 && (!needle || s.name.toLocaleLowerCase('vi').includes(needle)),
    )
  }, [servicesQuery.data, search])

  return (
    <div className="inv-stack">
      <section className="inv-panel" aria-label="Tồn kho thành phẩm">
        <div className="inv-filters">
          <div className="ds-search-input inv-filters__search">
            <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
            <input
              className="ds-input"
              type="search"
              value={search}
              aria-label="Tìm món quản lý tồn"
              placeholder="Tìm món…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <ListToolbar
          count={
            <>
              <strong>{managed.length}</strong> món quản lý tồn
            </>
          }
          actions={
            <RefreshButton
              loading={servicesQuery.isFetching}
              onClick={() => {
                void servicesQuery.refetch()
                void historyQuery.refetch()
              }}
            />
          }
        />
        {servicesQuery.isLoading ? (
          <StateView title="Đang tải danh mục…" />
        ) : servicesQuery.isError ? (
          <StateView
            title="Không tải được danh mục"
            description={describeInventoryError(servicesQuery.error)}
            action={
              <Button type="button" onClick={() => void servicesQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : managed.length === 0 ? (
          <StateView
            title="Chưa có món nào quản lý tồn"
            description="Chỉ món đã bật quản lý tồn kho (InventoryManagement) mới có kho thành phẩm."
          />
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Món</th>
                  <th className="is-num">Giá bán</th>
                  <th className="is-num">Tồn kho</th>
                  <th aria-label="Thao tác" />
                </tr>
              </thead>
              <tbody>
                {managed.map((s) => (
                  <tr key={s.id} className={s.active === 0 ? 'is-off' : ''}>
                    <td>
                      <strong>{s.name}</strong>
                      <small className="inv-muted">
                        #{s.id}
                        {s.groupName ? ` · ${s.groupName}` : ''}
                      </small>
                    </td>
                    <td className="is-num">{money(s.price)}</td>
                    <td className="is-num">
                      <StatusBadge tone={s.inventory <= 0 ? 'danger' : 'success'}>
                        {num(s.inventory)} {s.unit}
                      </StatusBadge>
                    </td>
                    <td className="inv-table__actions">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canImport}
                        title={canImport ? undefined : 'Cần quyền Quản lý kho (64)'}
                        onClick={() => setDialog({ kind: 'import', service: s })}
                      >
                        Nhập kho
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!canStocktake}
                        title={canStocktake ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                        onClick={() => setDialog({ kind: 'stocktake', service: s })}
                      >
                        Kiểm kê
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="inv-panel" aria-label="Lịch sử kho thành phẩm">
        <ListToolbar
          count={<strong>Lịch sử gần đây</strong>}
          actions={
            <Segmented<'imports' | 'stocktakes'>
              ariaLabel="Loại lịch sử"
              value={history}
              onChange={setHistory}
              options={[
                { value: 'imports', label: 'Nhập kho' },
                { value: 'stocktakes', label: 'Kiểm kê' },
              ]}
            />
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

      <ImportDialog
        service={dialog?.kind === 'import' ? dialog.service : null}
        onClose={() => setDialog(null)}
      />
      <StocktakeDialog
        service={dialog?.kind === 'stocktake' ? dialog.service : null}
        onClose={() => setDialog(null)}
      />
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

function ImportDialog({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
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
        <label className="ds-field inv-form__wide">
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="inv-form__wide">
          <InlineAlert tone={total !== null && total > 999_999_999 ? 'danger' : 'info'}>
            {total === null
              ? 'Nhập số nguyên cho số lượng và đơn giá.'
              : total > 999_999_999
                ? 'Thành tiền vượt giới hạn 999.999.999 đ.'
                : `Thành tiền ${money(total)} — máy chủ tính lại, không tin số này.`}
          </InlineAlert>
        </div>
      </div>
    </Dialog>
  )
}

function StocktakeDialog({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { getKey, clearKey } = useIdempotentIntent('fin-stktk')
  const [mode, setMode] = useState<'real' | 'adjust'>('real')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (service) {
      setMode('real')
      setValue('')
      setNote('')
      clearKey()
    }
  }, [service, clearKey])

  const parsed = parseWholeNumber(value, mode === 'adjust')
  const after = service && parsed !== null ? (mode === 'real' ? parsed : service.inventory + parsed) : null
  const valid = service !== null && parsed !== null && after !== null && after >= 0 && Math.abs(parsed) <= 1_000_000

  const mutation = useMutation({
    mutationFn: () => {
      if (!service || parsed === null) throw new Error('Dữ liệu chưa hợp lệ.')
      const body =
        mode === 'real'
          ? { serviceId: service.id, numReal: parsed, note: note.trim() || undefined }
          : { serviceId: service.id, numAdjust: parsed, note: note.trim() || undefined }
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
        <div className="inv-form__wide">
          <Segmented<'real' | 'adjust'>
            ariaLabel="Cách nhập kiểm kê"
            value={mode}
            onChange={(next) => {
              setMode(next)
              setValue('')
            }}
            options={[
              { value: 'real', label: 'Số đếm thực tế' },
              { value: 'adjust', label: 'Chênh lệch (+/−)' },
            ]}
          />
        </div>
        <label className="ds-field">
          <span className="ds-field__label">{mode === 'real' ? 'Số đếm thực tế' : 'Chênh lệch so với tồn'}</span>
          <input
            className="ds-input"
            inputMode="numeric"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
        </label>
        {after !== null ? (
          <div className="inv-form__wide">
            <InlineAlert tone={after < 0 ? 'danger' : 'info'}>
              {after < 0 ? 'Tồn sau điều chỉnh không được âm.' : `Tồn sau kiểm kê: ${num(after)} ${service.unit}`.trim()}
            </InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
