import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash } from '@phosphor-icons/react'
import { getMaterials, stockMaterial, type MaterialRow } from '../../api/inventory'
import { Button, Dialog, IconButton, InlineAlert, Select, StatusBadge } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  describeInventoryError,
  diffTone,
  formatDiff,
  formatQty,
  MAX_MATERIAL_BATCH,
  MOVE_TYPE_LABEL,
  previewStockAfter,
  stockMoveTotal,
  stocktakeDiff,
  suggestStockCode,
  toWireDecimal,
  validateStockHeader,
  validateStockLine,
  type MaterialMoveType,
} from './inventoryModel'

type BatchLine = { key: string; materialId: number; qty: string; price: string; note: string }

const QTY_HEADER: Record<MaterialMoveType, string> = { 1: 'Số lượng nhập', 2: 'Số lượng xuất', 3: 'Số đếm thực tế' }
const VOUCHER_TITLE: Record<MaterialMoveType, string> = { 1: 'Phiếu nhập kho', 2: 'Phiếu xuất / trả', 3: 'Phiếu kiểm kê' }
const NOTE_MAX = 255

const formatMoney = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`

/**
 * Phiếu nhập / xuất-trả / kiểm kê NHIỀU nguyên liệu (cùng kiểu phiếu của kho hàng hóa). Lưới luôn có sẵn một dòng trống: chọn
 * nguyên liệu (gõ để tìm) → nhập số → bấm "+" để thêm dòng kế tiếp. Máy chủ chỉ có endpoint từng nguyên liệu
 * (`/inventory/material/stock`) ⇒ ghi tuần tự từng dòng với CÙNG mã phiếu (khóa sổ là (nguyên liệu, loại, mã) nên dùng chung mã
 * cho nhiều nguyên liệu là hợp lệ). Không có giao dịch xuyên dòng: dòng ghi xong rời khỏi phiếu, dòng lỗi giữ lại kèm lý do
 * để sửa rồi ghi lại (không ghi trùng). `initialMaterialIds` = nguyên liệu tick sẵn ở danh sách (mỗi cái một dòng).
 * Chỉ mount khi mở — state khởi tạo từ props.
 */
export function MaterialBatchDialog({
  msType,
  initialMaterialIds = [],
  onClose,
  onRecorded,
}: {
  msType: MaterialMoveType
  initialMaterialIds?: readonly number[]
  onClose: () => void
  /** Gọi sau mỗi lượt ghi với các materialId đã ghi xong (để bỏ tick ở danh sách). */
  onRecorded?: (materialIds: number[]) => void
}) {
  const queryClient = useQueryClient()
  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })
  const all = materialsQuery.data?.rows ?? []
  // Máy chủ từ chối điều chỉnh kho của nguyên liệu ngừng dùng ⇒ chỉ cho chọn nguyên liệu đang dùng.
  const choices = all.filter((m) => m.isActive === 1)
  const byId = new Map<number, MaterialRow>(all.map((m) => [m.materialId, m]))

  const preset = initialMaterialIds.slice(0, MAX_MATERIAL_BATCH)
  const seq = useRef(Math.max(preset.length, 1) - 1)
  const blankLine = (): BatchLine => ({ key: `l${(seq.current += 1)}`, materialId: 0, qty: '', price: '', note: '' })
  const [lines, setLines] = useState<BatchLine[]>(() =>
    preset.length > 0
      ? preset.map((materialId, i) => ({ key: `l${i}`, materialId, qty: '', price: '', note: '' }))
      : [{ key: 'l0', materialId: 0, qty: '', price: '', note: '' }],
  )
  const [code, setCode] = useState(() => suggestStockCode(msType))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null)

  const hasPrice = msType !== 3
  const filled = lines.filter((l) => l.materialId > 0)
  const full = lines.length >= MAX_MATERIAL_BATCH
  const headerProblem = validateStockHeader({ code, note: '' })
  const lineProblem = (l: BatchLine) => validateStockLine({ msType, qty: l.qty, price: l.price }) ?? (l.note.length > NOTE_MAX ? `Ghi chú tối đa ${NOTE_MAX} ký tự.` : null)
  const voucherError =
    filled.length === 0 ? 'Chọn ít nhất một nguyên liệu.' : (headerProblem ?? filled.map(lineProblem).find((p) => p !== null) ?? null)
  const grandTotal = hasPrice ? filled.reduce((sum, l) => sum + (stockMoveTotal(l.qty, l.price) ?? 0), 0) : null

  const clearError = (key: string) =>
    setErrors((cur) => {
      if (!(key in cur)) return cur
      const { [key]: _removed, ...rest } = cur
      return rest
    })
  const updateLine = (key: string, patch: Partial<BatchLine>) => {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    clearError(key)
  }
  const addLine = () => setLines((cur) => (cur.length >= MAX_MATERIAL_BATCH ? cur : [...cur, blankLine()]))
  const removeLine = (key: string) => {
    setLines((cur) => {
      const next = cur.filter((l) => l.key !== key)
      return next.length > 0 ? next : [blankLine()]
    })
    clearError(key)
  }

  const submit = async () => {
    if (running || voucherError) return
    const trimmedCode = code.trim()
    const sending = filled
    const doneKeys = new Set<string>()
    const doneIds: number[] = []
    const failed: Record<string, string> = {}
    setRunning({ done: 0, total: sending.length })
    for (const line of sending) {
      try {
        await stockMaterial({
          materialId: line.materialId,
          msType,
          qty: toWireDecimal(line.qty) as string,
          price: line.price.trim() === '' ? undefined : (toWireDecimal(line.price) ?? undefined),
          code: trimmedCode,
          note: line.note.trim() || undefined,
        })
        doneKeys.add(line.key)
        doneIds.push(line.materialId)
      } catch (error) {
        failed[line.key] = describeInventoryError(error)
      }
      setRunning({ done: doneKeys.size + Object.keys(failed).length, total: sending.length })
    }
    setRunning(null)
    const failCount = Object.keys(failed).length
    if (doneIds.length > 0) {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onRecorded?.(doneIds)
    }
    if (failCount === 0) {
      pushToast(`${MOVE_TYPE_LABEL[msType]} xong ${doneIds.length} nguyên liệu.`, 'success')
      onClose()
      return
    }
    pushToast(`${MOVE_TYPE_LABEL[msType]}: ${doneIds.length} thành công, ${failCount} lỗi — xem các dòng báo đỏ.`, 'error')
    setErrors(failed)
    setLines((cur) => {
      const next = cur.filter((l) => !doneKeys.has(l.key))
      return next.length > 0 ? next : [blankLine()]
    })
  }

  const pending = running !== null

  return (
    <Dialog
      open
      size="lg"
      title={VOUCHER_TITLE[msType]}
      description="Chọn nguyên liệu, nhập số rồi bấm “+” để thêm dòng kế tiếp; ghi một lần. Dòng nào ghi được thì rời khỏi phiếu, dòng lỗi được giữ lại kèm lý do."
      onClose={pending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pending}
            disabled={voucherError !== null}
            title={voucherError ?? undefined}
            onClick={() => void submit()}
          >
            {running ? `Đang ghi ${running.done}/${running.total}…` : 'Ghi phiếu'}
          </Button>
        </>
      }
    >
      <div className="inv-voucher inv-voucher--compact">
        {materialsQuery.isError ? <InlineAlert tone="danger">Không tải được danh sách nguyên liệu.</InlineAlert> : null}

        <div className="inv-voucher__summary">
          <span>
            {filled.length} dòng
            {grandTotal !== null ? (
              <>
                {' '}
                · Tổng tiền cả phiếu: <strong>{formatMoney(grandTotal)}</strong>
              </>
            ) : null}
          </span>
          <label className="ds-input-group">
            <span className="ds-input-group-separator">Mã phiếu</span>
            <input
              className="ds-input"
              aria-label={msType === 2 ? 'Mã phiếu nhập đã có' : 'Mã phiếu'}
              value={code}
              maxLength={20}
              disabled={pending}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        </div>
        {headerProblem ? <InlineAlert tone="warning">{headerProblem}</InlineAlert> : null}
        {msType === 3 ? (
          <InlineAlert tone="info">
            Kiểm kê đặt tồn bằng số đếm thực tế; hệ thống ghi lại số cũ và chênh lệch để đối chiếu khi chốt kỳ.
          </InlineAlert>
        ) : null}

        {/* overflow hiện (--editable): danh sách thả xuống của combo không bị cắt bởi khung cuộn của bảng. */}
        <div className="inv-table-wrap inv-voucher__grid inv-voucher__grid--editable">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Nguyên liệu</th>
                {msType === 3 ? <th className="is-num">Tồn hiện tại</th> : null}
                <th className="is-num">{QTY_HEADER[msType]}</th>
                {hasPrice ? <th className="is-num">Đơn giá (đ)</th> : null}
                {hasPrice ? <th className="is-num">Thành tiền</th> : null}
                {msType === 3 ? <th>Chênh lệch</th> : <th className="is-num">Tồn trước → sau</th>}
                <th>Ghi chú</th>
                <th>Trạng thái</th>
                <th aria-label="Thêm / xoá dòng" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const m = byId.get(line.materialId)
                const hasMaterial = line.materialId > 0
                const touched = line.qty.trim() !== '' || line.price.trim() !== ''
                const localError = hasMaterial && touched ? lineProblem(line) : null
                const error = errors[line.key] ?? localError ?? undefined
                const valid = hasMaterial && lineProblem(line) === null
                const preview = m && valid ? previewStockAfter(m.stockQty, { msType, qty: line.qty }) : null
                const diff = m && msType === 3 && valid ? stocktakeDiff(m.stockQty, line.qty) : null
                const short = msType === 2 && preview?.short === true
                const total = hasPrice ? stockMoveTotal(line.qty, line.price) : null
                const takenByOthers = new Set(lines.filter((o) => o.key !== line.key).map((o) => o.materialId))
                return (
                  <tr key={line.key} className={errors[line.key] ? 'is-error' : undefined}>
                    <td className="inv-voucher__item-cell">
                      <Select
                        searchable
                        aria-label={`Nguyên liệu, dòng ${index + 1}`}
                        disabled={pending}
                        value={line.materialId}
                        onChange={(e) => updateLine(line.key, { materialId: Number(e.target.value) })}
                      >
                        <option value={0}>— Chọn nguyên liệu —</option>
                        {choices
                          .filter((c) => !takenByOthers.has(c.materialId))
                          .map((c) => (
                            <option key={c.materialId} value={c.materialId}>
                              {c.name}
                            </option>
                          ))}
                      </Select>
                    </td>
                    {msType === 3 ? <td className="is-num">{m ? `${formatQty(m.stockQty)} ${m.unit}`.trim() : '—'}</td> : null}
                    <td className="is-num">
                      <input
                        className="ds-input inv-cell-input"
                        inputMode="decimal"
                        aria-label={`${QTY_HEADER[msType]} ${m?.name ?? ''}`.trim()}
                        aria-invalid={error ? true : undefined}
                        disabled={pending || !hasMaterial}
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                      />
                    </td>
                    {hasPrice ? (
                      <td className="is-num">
                        <input
                          className="ds-input inv-cell-input"
                          inputMode="decimal"
                          aria-label={`Đơn giá ${m?.name ?? ''}`.trim()}
                          disabled={pending || !hasMaterial}
                          value={line.price}
                          onChange={(e) => updateLine(line.key, { price: e.target.value })}
                        />
                      </td>
                    ) : null}
                    {hasPrice ? (
                      <td className="is-num" title="Số lượng × đơn giá; máy chủ tính lại, không tin số này.">
                        {total === null ? '—' : formatMoney(total)}
                      </td>
                    ) : null}
                    {msType === 3 ? (
                      // Giống cột "Chênh lệch" của phiếu kiểm kê hàng hóa: âm = hao hụt (đỏ), dương (vàng), 0 = cân bằng.
                      <td>
                        {diff === null ? (
                          <span className="inv-muted">—</span>
                        ) : diffTone(diff) === 'neutral' ? (
                          <StatusBadge tone="success" dot>
                            Cân bằng
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone={diffTone(diff)} dot={false} title="Số đếm − tồn hiện tại">
                            {formatDiff(diff)} {m?.unit}
                          </StatusBadge>
                        )}
                      </td>
                    ) : (
                      // Nhập/xuất gộp tồn hiện tại và tồn sau phiếu vào MỘT cột ("10 → 12 kg") để lưới vừa hộp thoại.
                      <td className="is-num">
                        {!m ? (
                          '—'
                        ) : preview === null ? (
                          `${formatQty(m.stockQty)} ${m.unit}`.trim()
                        ) : (
                          <span style={short ? { color: 'var(--color-danger)' } : undefined}>
                            {formatQty(m.stockQty)} → {formatQty(preview.after)} {m.unit}
                          </span>
                        )}
                      </td>
                    )}
                    <td>
                      <input
                        className="ds-input inv-cell-input inv-cell-input--wide"
                        aria-label={`Ghi chú ${m?.name ?? ''}`.trim()}
                        disabled={pending || !hasMaterial}
                        maxLength={NOTE_MAX}
                        value={line.note}
                        onChange={(e) => updateLine(line.key, { note: e.target.value })}
                      />
                    </td>
                    <td className="inv-voucher__status">
                      {!hasMaterial ? (
                        <span className="inv-muted">—</span>
                      ) : error ? (
                        <>
                          <StatusBadge tone="danger" dot={false}>
                            Lỗi
                          </StatusBadge>
                          <small className="inv-error">{error}</small>
                        </>
                      ) : short ? (
                        <>
                          <StatusBadge tone="warning" dot={false}>
                            Cảnh báo
                          </StatusBadge>
                          <small className="inv-muted">Xuất vượt tồn hiện tại — máy chủ sẽ từ chối.</small>
                        </>
                      ) : (
                        <StatusBadge tone="neutral" dot={false}>
                          Chờ ghi
                        </StatusBadge>
                      )}
                    </td>
                    <td className="inv-voucher__row-actions">
                      {lines.length > 1 ? (
                        <IconButton
                          label={`Xoá dòng ${m?.name ?? index + 1}`}
                          icon={<Trash size={16} weight="bold" />}
                          disabled={pending}
                          onClick={() => removeLine(line.key)}
                        />
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {/* Nút thêm dòng nằm dưới dòng cuối (không chen vào cột thao tác của dòng). */}
          <div className="inv-voucher__add">
            <IconButton
              label={full ? `Tối đa ${MAX_MATERIAL_BATCH} dòng` : 'Thêm nguyên liệu kế tiếp'}
              variant="secondary"
              icon={<Plus size={16} weight="bold" />}
              disabled={pending || full || (lines.length > 0 && lines[lines.length - 1].materialId <= 0)}
              onClick={addLine}
            />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
