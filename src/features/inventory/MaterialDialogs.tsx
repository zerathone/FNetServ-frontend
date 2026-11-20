import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getUnits,
  saveMaterial,
  saveUnit,
  stockMaterial,
  type MaterialRow,
  type UnitRow,
} from '../../api/inventory'
import { Button, Dialog, InlineAlert, Select, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  describeInventoryError,
  formatDiff,
  formatQty,
  MOVE_TYPE_LABEL,
  previewStockAfter,
  stockMoveTotal,
  suggestStockCode,
  toWireDecimal,
  validateStockMove,
  type MaterialMoveType,
} from './inventoryModel'

// ===== Thêm / sửa nguyên liệu =====

export function MaterialEditor({
  material,
  open,
  onClose,
}: {
  /** null = thêm mới. */
  material: MaterialRow | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const unitsQuery = useQuery({ queryKey: ['inventory', 'units'], queryFn: getUnits, enabled: open })
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [unitId, setUnitId] = useState(0)
  const [minStock, setMinStock] = useState('')
  const [active, setActive] = useState(true)

  useEffect(() => {
    if (!open) return
    setName(material?.name ?? '')
    setNote(material?.materialNote ?? '')
    setUnitId(material?.unitId ?? 0)
    setMinStock(material ? formatPlain(material.minStockQty) : '')
    setActive(material ? material.isActive === 1 : true)
  }, [open, material])

  const mutation = useMutation({
    mutationFn: () => {
      const min = minStock.trim() === '' ? undefined : (toWireDecimal(minStock) ?? undefined)
      return saveMaterial({
        materialId: material?.materialId,
        name: name.trim(),
        note: note.trim(),
        unitId,
        minStockQty: min,
        isActive: material ? active : undefined,
      })
    },
    onSuccess: (result) => {
      pushToast(result.created ? 'Đã thêm nguyên liệu.' : 'Đã lưu nguyên liệu.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  const minBad = minStock.trim() !== '' && toWireDecimal(minStock) === null
  const valid = name.trim().length > 0 && name.trim().length <= 255 && !minBad
  const units = (unitsQuery.data?.rows ?? []).filter((u) => u.isActive === 1 || u.id === unitId)

  return (
    <Dialog
      open={open}
      title={material ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu'}
      description="Tồn kho không sửa ở đây — dùng Nhập, Xuất hoặc Kiểm kê để có phiếu đối chiếu."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={mutation.isPending}
            disabled={!valid}
            onClick={() => mutation.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="inv-form inv-form--select-room">
        <label className="ds-field inv-form__wide">
          <span className="ds-field__label">Tên nguyên liệu</span>
          <input className="ds-input" value={name} maxLength={255} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Đơn vị tính</span>
          <Select className="ds-input" value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
            <option value={0}>Chưa chọn</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit}
              </option>
            ))}
          </Select>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Tồn tối thiểu (cảnh báo sắp hết)</span>
          <input
            className="ds-input"
            inputMode="decimal"
            value={minStock}
            placeholder="0"
            aria-invalid={minBad}
            onChange={(e) => setMinStock(e.target.value)}
          />
        </label>
        <label className="ds-field inv-form__wide">
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
        </label>
        {material ? (
          <div className="inv-form__wide">
            <Switch
              checked={active}
              onCheckedChange={setActive}
              label="Đang sử dụng"
              description="Nguyên liệu đang nằm trong công thức hoặc topping thì không thể ngừng."
            />
          </div>
        ) : null}
        {minBad ? (
          <div className="inv-form__wide">
            <InlineAlert tone="warning">Tồn tối thiểu phải là số không âm, tối đa 3 số lẻ.</InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

/** "1.500" → "1.5" để đưa lại vào ô nhập (không dấu phân cách nghìn). */
function formatPlain(value: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!m) return ''
  const frac = (m[2] ?? '').replace(/0+$/, '')
  const out = frac ? `${m[1]}.${frac}` : m[1]
  return out === '0' ? '' : out
}

// ===== Đơn vị tính =====

export function UnitsDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const unitsQuery = useQuery({ queryKey: ['inventory', 'units'], queryFn: getUnits, enabled: open })
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)

  const mutation = useMutation({
    mutationFn: (body: { id?: number; unit: string; isActive?: boolean }) => saveUnit(body),
    onSuccess: () => {
      pushToast('Đã lưu đơn vị.', 'success')
      setNewName('')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  const rows: UnitRow[] = unitsQuery.data?.rows ?? []
  return (
    <Dialog
      open={open}
      title="Đơn vị tính"
      description={canEdit ? 'Thêm đơn vị mới, đổi tên hoặc ẩn đơn vị không dùng.' : 'Bạn chưa có quyền quản lý đơn vị (67).'}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Đóng
        </Button>
      }
    >
      <div className="inv-units">
        {canEdit ? (
          <form
            className="inv-units__add"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) mutation.mutate({ unit: newName.trim() })
            }}
          >
            <input
              className="ds-input"
              aria-label="Tên đơn vị mới"
              placeholder="Ví dụ: kg, lít, gói"
              value={newName}
              maxLength={50}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!newName.trim()}>
              Thêm
            </Button>
          </form>
        ) : null}
        {unitsQuery.isLoading ? <p className="inv-muted">Đang tải…</p> : null}
        <ul className="inv-units__list">
          {rows.map((u) => (
            <li key={u.id} className={u.isActive === 1 ? '' : 'is-off'}>
              {editing?.id === u.id ? (
                <>
                  <input
                    className="ds-input"
                    aria-label="Tên đơn vị"
                    value={editing.name}
                    maxLength={50}
                    autoFocus
                    onChange={(e) => setEditing({ id: u.id, name: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    loading={mutation.isPending}
                    disabled={!editing.name.trim()}
                    onClick={() => mutation.mutate({ id: u.id, unit: editing.name.trim(), isActive: u.isActive === 1 })}
                  >
                    Lưu
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Hủy
                  </Button>
                </>
              ) : (
                <>
                  <span>{u.unit}</span>
                  {u.isActive === 1 ? null : <small className="inv-muted">đã ẩn</small>}
                  {canEdit ? (
                    <span className="inv-units__actions">
                      <Button type="button" variant="ghost" onClick={() => setEditing({ id: u.id, name: u.unit })}>
                        Sửa
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: u.id, unit: u.unit, isActive: u.isActive !== 1 })}
                      >
                        {u.isActive === 1 ? 'Ẩn' : 'Hiện'}
                      </Button>
                    </span>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
        {!unitsQuery.isLoading && rows.length === 0 ? <p className="inv-muted">Chưa có đơn vị nào.</p> : null}
      </div>
    </Dialog>
  )
}

// ===== Phiếu nhập / xuất / kiểm kê =====

export function StockDialog({
  material,
  msType,
  onClose,
}: {
  material: MaterialRow | null
  msType: MaterialMoveType
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const open = material !== null
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setQty('')
    setPrice('')
    setCode(suggestStockCode(msType))
    setNote('')
  }, [open, msType, material?.materialId])

  const mutation = useMutation({
    mutationFn: () => {
      if (!material) throw new Error('Chưa chọn nguyên liệu.')
      const wireQty = toWireDecimal(qty)
      if (wireQty === null) throw new Error('Số lượng không hợp lệ.')
      return stockMaterial({
        materialId: material.materialId,
        msType,
        qty: wireQty,
        price: price.trim() === '' ? undefined : (toWireDecimal(price) ?? undefined),
        code: code.trim(),
        note: note.trim() || undefined,
      })
    },
    onSuccess: (result) => {
      const diff = result.diff !== undefined ? ` (lệch ${formatDiff(result.diff)})` : ''
      pushToast(
        `${MOVE_TYPE_LABEL[msType]} xong: ${formatQty(result.stockBefore)} → ${formatQty(result.stockAfter)}${diff}.`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  if (!material) return null
  const problem = validateStockMove({ msType, qty, price, code, note })
  const preview = qty.trim() === '' ? null : previewStockAfter(material.stockQty, { msType, qty })
  const qtyLabel = msType === 3 ? 'Số đếm thực tế' : msType === 1 ? 'Số lượng nhập' : 'Số lượng xuất'
  const total = msType === 3 ? null : stockMoveTotal(qty, price)

  return (
    <Dialog
      open
      title={`${MOVE_TYPE_LABEL[msType]} — ${material.name}`}
      description={`Tồn hiện tại ${formatQty(material.stockQty)} ${material.unit}`.trim()}
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={mutation.isPending}
            disabled={problem !== null}
            onClick={() => mutation.mutate()}
          >
            Ghi phiếu
          </Button>
        </>
      }
    >
      <div className="inv-form">
        <label className="ds-field">
          <span className="ds-field__label">
            {qtyLabel} {material.unit ? `(${material.unit})` : ''}
          </span>
          <input
            className="ds-input"
            inputMode="decimal"
            value={qty}
            autoFocus
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        {msType !== 3 ? (
          <label className="ds-field">
            <span className="ds-field__label">Đơn giá (đ, không bắt buộc)</span>
            <input className="ds-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
        ) : null}
        {msType !== 3 ? (
          <div className="ds-field">
            <span className="ds-field__label">Tổng tiền</span>
            <span className="inv-form__static" title="Số lượng × đơn giá; máy chủ tính lại, không tin số này.">
              {total === null ? '—' : `${new Intl.NumberFormat('vi-VN').format(total)} đ`}
            </span>
          </div>
        ) : null}
        <label className="ds-field">
          <span className="ds-field__label">
            {msType === 2 ? 'Mã phiếu NHẬP đã có' : 'Mã phiếu'}
          </span>
          <input className="ds-input" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className={msType !== 3 ? 'ds-field inv-form__wide' : 'ds-field'}>
          <span className="ds-field__label">Ghi chú</span>
          <input className="ds-input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
        </label>
        {preview ? (
          <div className="inv-form__wide">
            <InlineAlert tone={preview.short ? 'danger' : 'info'}>
              {preview.short
                ? `Không đủ tồn để xuất (còn ${formatQty(material.stockQty)}).`
                : `Tồn sau phiếu: ${formatQty(preview.after)} ${material.unit}`.trim()}
            </InlineAlert>
          </div>
        ) : null}
        {msType === 3 ? (
          <div className="inv-form__wide">
            <InlineAlert tone="info">
              Kiểm kê đặt tồn bằng số đếm thực tế; hệ thống ghi lại số cũ và chênh lệch để đối chiếu khi chốt kỳ.
            </InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
