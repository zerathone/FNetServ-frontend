import { useRef, useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConvertUnits,
  getUnits,
  importFinishedBatch,
  removeConvertUnit,
  saveConvertUnit,
  stocktakeFinishedBatch,
  type ConvertUnitList,
} from '../../api/inventory'
import { type ServiceItem } from '../../api/services'
import {
  Button,
  ConfirmAction,
  Dialog,
  IconButton,
  InlineAlert,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  batchStatusLabel,
  checkStocktakeLine,
  diffBadge,
  formatInt,
  formatMoney,
  importBatchLines,
  importLineTotal,
  importVoucherTotal,
  LINE_STATUS_LABEL,
  lineStatus,
  MAX_BATCH_LINES,
  mergeBatchResults,
  NOTE_MAX,
  parseUnitFactor,
  RIGHT_FINISHED_CONVERT_UNIT,
  stocktakeBatchLines,
  unitChoices,
  unitFactorOf,
  unitFactorText,
  validateImportLine,
  validateImportVoucher,
  type ImportDraftLine,
  type StocktakeDraftLine,
  type StocktakeMode,
} from './finishedStockModel'
import { describeInventoryError } from './inventoryModel'
import { useFinishedServices } from './useFinishedServices'
import './inventory.css'

/** Sau mọi lần ghi: số tồn (tab Dịch vụ, Tồn kho) và mọi báo cáo kho thành phẩm phải tải lại. */
function useInvalidateFinished() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['services'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'finished'] })
  }
}

const unitsKey = (serviceId: number) => ['inventory', 'finished', 'units', serviceId] as const

/** Tải đơn vị quy đổi của các món đang có trong phiếu (mỗi món một request, dùng chung cache). */
function useUnitLists(serviceIds: readonly number[]) {
  const ids = [...new Set(serviceIds.filter((id) => id > 0))]
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: unitsKey(id), queryFn: () => getConvertUnits(id), staleTime: 30_000 })),
  })
  const map = new Map<number, ConvertUnitList>()
  ids.forEach((id, i) => {
    const data = results[i]?.data
    if (data) map.set(id, data)
  })
  return map
}

/** Các món điền sẵn vào lưới phiếu: danh sách tick > một món > một dòng trống (0). Luôn ≥ 1 phần tử, ≤ MAX_BATCH_LINES, không trùng. */
function presetServiceIds(single?: number, many?: readonly number[]): number[] {
  const ids = [...new Set((many && many.length > 0 ? many : single ? [single] : []).filter((id) => id > 0))]
  return ids.length > 0 ? ids.slice(0, MAX_BATCH_LINES) : [0]
}

function serviceOptions(services: readonly ServiceItem[], excludeIds?: ReadonlySet<number>) {
  return services
    .filter((s) => !excludeIds?.has(s.id))
    .map((s) => (
      <option key={s.id} value={s.id}>
        <span className="ds-option-name">{s.name}</span>
        {s.groupName ? <strong className="ds-option-tag">{s.groupName}</strong> : null}
      </option>
    ))
}

// =====================================================================================================================
// Phiếu nhập kho nhiều dòng
// =====================================================================================================================

type ImportLineState = Omit<ImportDraftLine, 'factor'>

/**
 * Phiếu nhập kho nhiều dòng (quyền 64). Lưới luôn có sẵn một dòng trống: chọn mặt hàng (gõ để tìm) → số lượng, đơn vị, giá →
 * bấm "+" ở cuối dòng để thêm dòng kế tiếp (cùng kiểu phiếu kiểm kê). Dòng chưa chọn mặt hàng bị bỏ qua khi ghi.
 * Từng dòng ghi độc lập (MyISAM không rollback): dòng ok biến khỏi lưới, dòng lỗi giữ lại kèm lý do để sửa rồi ghi lại.
 * `initialServiceId` = mở từ nút Nhập kho ở dòng mặt hàng (món đã chọn sẵn ở dòng đầu).
 */
export function ImportVoucherDialog({
  initialServiceId,
  initialServiceIds,
  onClose,
}: {
  initialServiceId?: number
  /** Nhiều món chọn sẵn (tick ở danh sách Tồn kho): mỗi món một dòng, tối đa MAX_BATCH_LINES. */
  initialServiceIds?: readonly number[]
  onClose: () => void
}) {
  const invalidate = useInvalidateFinished()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canConvert = hasRight(RIGHT_FINISHED_CONVERT_UNIT)
  const { getKey, clearKey } = useIdempotentIntent('fin-imp')
  const { managed, byId, query: servicesQuery } = useFinishedServices()

  const presetIds = presetServiceIds(initialServiceId, initialServiceIds)
  const seq = useRef(presetIds.length - 1)
  const nextKey = () => `l${(seq.current += 1)}`
  const blankLine = (): ImportLineState => ({ key: nextKey(), serviceId: 0, unitId: 0, quantity: '', price: '', note: '' })
  const [lines, setLines] = useState<ImportLineState[]>(() =>
    presetIds.map((id, i) => ({ key: `l${i}`, serviceId: id, unitId: 0, quantity: '', price: '', note: '' })),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<string | null>(null)
  const [unitsFor, setUnitsFor] = useState<ServiceItem | null>(null)

  const unitLists = useUnitLists(lines.map((l) => l.serviceId))
  const choicesFor = (id: number) => unitChoices(unitLists.get(id), byId.get(id)?.unit ?? '')
  const withFactor = (l: ImportLineState): ImportDraftLine => ({
    ...l,
    factor: unitFactorOf(choicesFor(l.serviceId), l.unitId),
  })
  const effective = lines.map(withFactor)
  const filled = effective.filter((l) => l.serviceId > 0)
  const full = lines.length >= MAX_BATCH_LINES
  const voucherError = filled.length === 0 ? 'Chọn ít nhất một mặt hàng.' : validateImportVoucher(filled)

  const clearError = (key: string) =>
    setErrors((cur) => {
      if (!(key in cur)) return cur
      const { [key]: _removed, ...rest } = cur
      return rest
    })
  const updateLine = (key: string, patch: Partial<ImportLineState>) => {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    clearError(key)
  }
  const addLine = () => setLines((cur) => (cur.length >= MAX_BATCH_LINES ? cur : [...cur, blankLine()]))
  const removeLine = (key: string) => {
    setLines((cur) => {
      const next = cur.filter((l) => l.key !== key)
      return next.length > 0 ? next : [blankLine()]
    })
    clearError(key)
  }

  const mutation = useMutation({
    mutationFn: (sent: ImportDraftLine[]) => {
      const body = importBatchLines(sent)
      // Cùng nội dung ⇒ cùng idem: bấm lại sau timeout không nhập đôi. Nội dung đổi (đã bỏ dòng ok, sửa dòng lỗi) ⇒ idem mới.
      return importFinishedBatch({ idem: getKey(JSON.stringify(body)), lines: body })
    },
    onSuccess: (result, sent) => {
      clearKey() // đã nhận phản hồi ⇒ lần ghi lại dòng lỗi phải được xử lý mới, không đọc lại kết quả cũ
      const outcome = mergeBatchResults(sent, result.results)
      setLines((cur) => {
        const next = cur.filter((l) => !outcome.okKeys.has(l.key))
        return next.length > 0 ? next : [blankLine()]
      })
      setErrors(outcome.errors)
      setRequestError(null)
      const rounded = result.results.filter((r) => r.ok && r.priceRounded).length
      const parts = [
        batchStatusLabel(outcome.okCount, outcome.failCount),
        outcome.okCount > 0 ? `Tổng tiền ${formatMoney(result.totalAmount)}.` : '',
        rounded > 0 ? `${rounded} dòng có giá lẻ bị cắt khi quy về đơn vị gốc.` : '',
        result.duplicated ? '(phiếu đã ghi trước đó)' : '',
      ]
      pushToast(parts.filter(Boolean).join(' '), outcome.failCount === 0 ? 'success' : 'error')
      invalidate()
      if (outcome.failCount === 0) onClose()
    },
    onError: (error) => {
      const message = describeInventoryError(error)
      setRequestError(message)
      pushToast(message, 'error')
    },
  })

  const pending = mutation.isPending
  // "Đơn vị quy đổi" áp cho mặt hàng ở dòng đã chọn dưới cùng của phiếu.
  const unitsTarget = [...filled].reverse().map((l) => byId.get(l.serviceId)).find((s) => s !== undefined)

  return (
    <>
      <Dialog
        open
        size="lg"
        title="Phiếu nhập kho"
        description="Chọn mặt hàng, nhập số lượng và giá rồi bấm “+” để thêm dòng kế tiếp; ghi một lần. Dòng nào ghi được thì rời khỏi phiếu, dòng lỗi được giữ lại kèm lý do."
        onClose={pending || unitsFor ? () => undefined : onClose}
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
              onClick={() => mutation.mutate(filled)}
            >
              Ghi phiếu
            </Button>
          </>
        }
      >
        <div className="inv-voucher">
          {servicesQuery.isError ? (
            <InlineAlert tone="danger">Không tải được danh sách mặt hàng.</InlineAlert>
          ) : null}
          {requestError ? <InlineAlert tone="danger">{requestError}</InlineAlert> : null}

          {/* Thanh tóm tắt phía trên lưới: số dòng + tổng tiền cả phiếu (trái), quản lý đơn vị quy đổi (phải). */}
          <div className="inv-voucher__summary">
            <span>
              {filled.length} dòng · Tổng tiền cả phiếu: <strong>{formatMoney(importVoucherTotal(filled))}</strong>
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={!canConvert || !unitsTarget}
              title={
                !canConvert
                  ? 'Cần quyền Quản lý đơn vị quy đổi (65)'
                  : unitsTarget
                    ? `Quản lý đơn vị quy đổi của ${unitsTarget.name}`
                    : 'Chọn mặt hàng trước'
              }
              onClick={() => unitsTarget && setUnitsFor(unitsTarget)}
            >
              Đơn vị quy đổi
            </Button>
          </div>

          {/* overflow hiện (--editable): danh sách thả xuống của combo không bị cắt bởi khung cuộn của bảng. */}
          <div className="inv-table-wrap inv-voucher__grid inv-voucher__grid--editable">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Mặt hàng</th>
                  <th className="is-num">Số lượng</th>
                  <th>Đơn vị nhập</th>
                  <th className="is-num">Giá nhập</th>
                  <th className="is-num">Thành tiền</th>
                  <th>Ghi chú</th>
                  <th>Trạng thái</th>
                  <th aria-label="Thêm / xoá dòng" />
                </tr>
              </thead>
              <tbody>
                {effective.map((line, index) => {
                  const service = byId.get(line.serviceId)
                  const hasService = line.serviceId > 0
                  const isLast = index === effective.length - 1
                  const choices = choicesFor(line.serviceId)
                  const total = importLineTotal(line)
                  const touched = line.quantity.trim() !== '' || line.price.trim() !== ''
                  const localError = hasService && touched ? validateImportLine(line) : null
                  const error = errors[line.key] ?? localError ?? undefined
                  const status = lineStatus(error, undefined)
                  const takenByOthers = new Set(lines.filter((o) => o.key !== line.key).map((o) => o.serviceId))
                  return (
                    <tr key={line.key} className={errors[line.key] ? 'is-error' : undefined}>
                      <td className="inv-voucher__item-cell">
                        <Select
                          searchable
                          aria-label={`Mặt hàng nhập kho, dòng ${index + 1}`}
                          disabled={pending}
                          value={line.serviceId}
                          onChange={(e) => updateLine(line.key, { serviceId: Number(e.target.value), unitId: 0 })}
                        >
                          <option value={0}>— Chọn mặt hàng —</option>
                          {serviceOptions(managed, takenByOthers)}
                        </Select>
                      </td>
                      <td className="is-num">
                        <input
                          className="ds-input inv-cell-input"
                          inputMode="numeric"
                          aria-label={`Số lượng ${service?.name ?? ''}`}
                          disabled={pending || !hasService}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        />
                      </td>
                      <td>
                        <Select
                          aria-label={`Đơn vị nhập ${service?.name ?? ''}`}
                          disabled={pending || !hasService}
                          value={line.unitId}
                          onChange={(e) => updateLine(line.key, { unitId: Number(e.target.value) })}
                        >
                          {choices.map((c) => (
                            <option key={c.unitId} value={c.unitId}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="is-num">
                        <input
                          className="ds-input inv-cell-input"
                          inputMode="numeric"
                          aria-label={`Giá nhập ${service?.name ?? ''}`}
                          disabled={pending || !hasService}
                          value={line.price}
                          onChange={(e) => updateLine(line.key, { price: e.target.value })}
                        />
                      </td>
                      <td className="is-num" title="Số lượng × giá nhập; máy chủ tính lại, không tin số này.">
                        {total === null ? '—' : formatMoney(total)}
                      </td>
                      <td>
                        <input
                          className="ds-input inv-cell-input inv-cell-input--wide"
                          aria-label={`Ghi chú ${service?.name ?? ''}`}
                          disabled={pending || !hasService}
                          maxLength={NOTE_MAX}
                          value={line.note}
                          onChange={(e) => updateLine(line.key, { note: e.target.value })}
                        />
                      </td>
                      <td className="inv-voucher__status">
                        {!hasService ? (
                          <span className="inv-muted">—</span>
                        ) : error ? (
                          <>
                            <StatusBadge tone="danger" dot={false}>
                              {LINE_STATUS_LABEL[status]}
                            </StatusBadge>
                            <small className="inv-error">{error}</small>
                          </>
                        ) : (
                          <StatusBadge tone="neutral" dot={false}>
                            {LINE_STATUS_LABEL.pending}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="inv-voucher__row-actions">
                        {isLast ? (
                          <IconButton
                            label={full ? `Tối đa ${MAX_BATCH_LINES} dòng` : 'Thêm mặt hàng kế tiếp'}
                            variant="secondary"
                            icon={<Plus size={16} weight="bold" />}
                            disabled={pending || !hasService || full}
                            onClick={addLine}
                          />
                        ) : null}
                        {!isLast || effective.length > 1 ? (
                          <IconButton
                            label={`Xoá dòng ${service?.name ?? index + 1}`}
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
          </div>

        </div>
      </Dialog>
      {unitsFor ? <ConvertUnitsDialog service={unitsFor} canEdit={canConvert} onClose={() => setUnitsFor(null)} /> : null}
    </>
  )
}

// =====================================================================================================================
// Phiếu kiểm kê nhiều dòng
// =====================================================================================================================

/** Kiểm kê luôn nhập SỐ THỰC TẾ (đã bỏ cách nhập "số điều chỉnh"); máy chủ tự suy ra chênh lệch so với tồn hiện tại. */
const STOCKTAKE_MODE: StocktakeMode = 'real'

/** Dòng lưới kiểm kê. `value === null` = chưa sửa ⇒ số thực tế lấy luôn bằng "Tồn hiện tại" (dòng "Cân bằng"). */
type StocktakeRowState = { key: string; serviceId: number; value: string | null; note: string }

/**
 * Phiếu kiểm kê nhiều dòng (quyền 68). Lưới luôn có sẵn một dòng trống: chọn mặt hàng (gõ để tìm) → sửa số thực tế →
 * bấm "+" ở cuối dòng để thêm dòng kế tiếp. Kiểm kê KHÔNG đổi "Dự kiến" (chủ đích của Qt — đó là cách sinh ra cột
 * Chênh lệch); làm TĂNG tồn vượt Dự kiến bị máy chủ từ chối (Q14). Dòng chưa chọn mặt hàng bị bỏ qua khi ghi.
 */
export function StocktakeVoucherDialog({
  initialServiceId,
  initialServiceIds,
  onClose,
}: {
  initialServiceId?: number
  /** Nhiều món chọn sẵn (tick ở danh sách Tồn kho): mỗi món một dòng, tối đa MAX_BATCH_LINES. */
  initialServiceIds?: readonly number[]
  onClose: () => void
}) {
  const invalidate = useInvalidateFinished()
  const { getKey, clearKey } = useIdempotentIntent('fin-stk')
  const { managed, byId, query: servicesQuery } = useFinishedServices()

  const presetIds = presetServiceIds(initialServiceId, initialServiceIds)
  const seq = useRef(presetIds.length - 1)
  const nextKey = () => `l${(seq.current += 1)}`
  const blankLine = (): StocktakeRowState => ({ key: nextKey(), serviceId: 0, value: null, note: '' })
  const [lines, setLines] = useState<StocktakeRowState[]>(() =>
    presetIds.map((id, i) => ({ key: `l${i}`, serviceId: id, value: null, note: '' })),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<string | null>(null)

  const snapshotOf = (id: number) => {
    const s = byId.get(id)
    return { inventory: s?.inventory ?? 0, expected: s?.inventoryExpected }
  }
  const effectiveValue = (l: StocktakeRowState) => l.value ?? String(snapshotOf(l.serviceId).inventory)
  const toDraft = (l: StocktakeRowState): StocktakeDraftLine => ({
    key: l.key,
    serviceId: l.serviceId,
    value: effectiveValue(l),
    note: l.note,
  })

  const checks = lines.map((l) => ({
    line: l,
    check: l.serviceId > 0 ? checkStocktakeLine(STOCKTAKE_MODE, effectiveValue(l), snapshotOf(l.serviceId), l.note) : null,
  }))
  const filled = lines.filter((l) => l.serviceId > 0)
  const bad = checks.find((c) => c.check && !c.check.ok)?.check
  const voucherError =
    filled.length === 0
      ? 'Chọn ít nhất một mặt hàng.'
      : filled.length > MAX_BATCH_LINES
        ? `Một phiếu tối đa ${MAX_BATCH_LINES} dòng.`
        : bad && !bad.ok
          ? bad.error
          : null
  const full = lines.length >= MAX_BATCH_LINES

  const clearError = (key: string) =>
    setErrors((cur) => {
      if (!(key in cur)) return cur
      const { [key]: _removed, ...rest } = cur
      return rest
    })
  const updateLine = (key: string, patch: Partial<StocktakeRowState>) => {
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    clearError(key)
  }
  const addLine = () => setLines((cur) => (cur.length >= MAX_BATCH_LINES ? cur : [...cur, blankLine()]))
  const removeLine = (key: string) => {
    setLines((cur) => {
      const next = cur.filter((l) => l.key !== key)
      return next.length > 0 ? next : [blankLine()]
    })
    clearError(key)
  }

  const mutation = useMutation({
    mutationFn: (sent: StocktakeDraftLine[]) => {
      const body = stocktakeBatchLines(STOCKTAKE_MODE, sent)
      return stocktakeFinishedBatch({ idem: getKey(JSON.stringify(body)), lines: body })
    },
    onSuccess: (result, sent) => {
      clearKey()
      const outcome = mergeBatchResults(sent, result.results)
      setLines((cur) => {
        const next = cur.filter((l) => !outcome.okKeys.has(l.key))
        return next.length > 0 ? next : [blankLine()]
      })
      setErrors(outcome.errors)
      setRequestError(null)
      pushToast(
        `${batchStatusLabel(outcome.okCount, outcome.failCount)}${result.duplicated ? ' (phiếu đã ghi trước đó)' : ''}`,
        outcome.failCount === 0 ? 'success' : 'error',
      )
      invalidate()
      if (outcome.failCount === 0) onClose()
    },
    onError: (error) => {
      const message = describeInventoryError(error)
      setRequestError(message)
      pushToast(message, 'error')
    },
  })
  const pending = mutation.isPending

  return (
    <Dialog
      open
      size="lg"
      title="Phiếu kiểm kê"
      description="Chọn mặt hàng, sửa số thực tế rồi bấm “+” để thêm dòng kế tiếp; ghi một lần. Dòng nào ghi được thì rời khỏi phiếu, dòng lỗi được giữ lại kèm lý do."
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
            onClick={() => mutation.mutate(filled.map(toDraft))}
          >
            Ghi phiếu
          </Button>
        </>
      }
    >
      <div className="inv-voucher">
        {servicesQuery.isError ? <InlineAlert tone="danger">Không tải được danh sách mặt hàng.</InlineAlert> : null}
        {requestError ? <InlineAlert tone="danger">{requestError}</InlineAlert> : null}

        <div className="inv-voucher__summary">
          <span>{filled.length} dòng</span>
        </div>

        {/* overflow hiện (--editable): danh sách thả xuống của combo mặt hàng không bị cắt bởi khung cuộn của bảng. */}
        <div className="inv-table-wrap inv-voucher__grid inv-voucher__grid--editable">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Mặt hàng</th>
                <th>Đơn vị</th>
                <th className="is-num">Tồn hiện tại</th>
                <th className="is-num">Dự kiến</th>
                <th className="is-num">Thực tế</th>
                <th>Chênh lệch so với tồn hiện tại</th>
                <th>Ghi chú</th>
                <th>Trạng thái</th>
                <th aria-label="Thêm / xoá dòng" />
              </tr>
            </thead>
            <tbody>
              {checks.map(({ line, check }, index) => {
                const service = byId.get(line.serviceId)
                const isLast = index === checks.length - 1
                const hasService = line.serviceId > 0
                const takenByOthers = new Set(lines.filter((o) => o.key !== line.key).map((o) => o.serviceId))
                const serverError = errors[line.key]
                const localError = check && !check.ok ? check.error : undefined
                const warning = check?.ok ? check.warning : undefined
                const error = serverError ?? localError
                const status = lineStatus(error, warning)
                const badge = check?.ok ? diffBadge(check.adjust) : null
                return (
                  <tr key={line.key} className={serverError ? 'is-error' : undefined}>
                    <td className="inv-voucher__item-cell">
                      <Select
                        searchable
                        aria-label={`Mặt hàng kiểm kê, dòng ${index + 1}`}
                        disabled={pending}
                        value={line.serviceId}
                        onChange={(e) => updateLine(line.key, { serviceId: Number(e.target.value), value: null })}
                      >
                        <option value={0}>— Chọn mặt hàng —</option>
                        {serviceOptions(managed, takenByOthers)}
                      </Select>
                    </td>
                    <td>{service?.unit ? service.unit : <span className="inv-muted">—</span>}</td>
                    <td className="is-num">{service ? formatInt(service.inventory) : '—'}</td>
                    <td className="is-num">{service?.inventoryExpected === undefined ? '—' : formatInt(service.inventoryExpected)}</td>
                    <td className="is-num">
                      <input
                        className="ds-input inv-cell-input"
                        inputMode="numeric"
                        aria-label={`Số lượng thực tế ${service?.name ?? ''}`}
                        disabled={pending || !hasService}
                        value={hasService ? effectiveValue(line) : ''}
                        onChange={(e) => updateLine(line.key, { value: e.target.value })}
                      />
                    </td>
                    <td>
                      {check?.ok ? (
                        badge ? (
                          <StatusBadge tone={badge.tone} dot={false}>
                            {badge.text}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="success" dot>
                            Cân bằng
                          </StatusBadge>
                        )
                      ) : (
                        <span className="inv-muted">—</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="ds-input inv-cell-input inv-cell-input--wide"
                        aria-label={`Ghi chú ${service?.name ?? ''}`}
                        disabled={pending || !hasService}
                        maxLength={NOTE_MAX}
                        value={line.note}
                        onChange={(e) => updateLine(line.key, { note: e.target.value })}
                      />
                    </td>
                    <td className="inv-voucher__status">
                      {!hasService ? (
                        <span className="inv-muted">—</span>
                      ) : error ? (
                        <>
                          <StatusBadge tone="danger" dot={false}>
                            {LINE_STATUS_LABEL[status]}
                          </StatusBadge>
                          <small className="inv-error">{error}</small>
                        </>
                      ) : warning ? (
                        <>
                          <StatusBadge tone="warning" dot={false}>
                            {LINE_STATUS_LABEL[status]}
                          </StatusBadge>
                          <small className="inv-warn">{warning}</small>
                        </>
                      ) : (
                        <StatusBadge tone="neutral" dot={false}>
                          {LINE_STATUS_LABEL.pending}
                        </StatusBadge>
                      )}
                    </td>
                    <td className="inv-voucher__row-actions">
                      {isLast ? (
                        <IconButton
                          label={full ? `Tối đa ${MAX_BATCH_LINES} dòng` : 'Thêm mặt hàng kế tiếp'}
                          variant="secondary"
                          icon={<Plus size={16} weight="bold" />}
                          disabled={pending || !hasService || full}
                          onClick={addLine}
                        />
                      ) : null}
                      {!isLast || checks.length > 1 ? (
                        <IconButton
                          label={`Xoá dòng ${service?.name ?? index + 1}`}
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
        </div>
      </div>
    </Dialog>
  )
}

// =====================================================================================================================
// Đơn vị quy đổi của một món (quyền 65)
// =====================================================================================================================

/** Hộp quản lý hệ số quy đổi: "1 [đơn vị] = N [đơn vị gốc]". Dòng đơn vị gốc (hệ số 1) không xoá được; hệ số ≥ 2. */
export function ConvertUnitsDialog({
  service,
  canEdit,
  onClose,
}: {
  service: ServiceItem
  canEdit: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const listQuery = useQuery({ queryKey: unitsKey(service.id), queryFn: () => getConvertUnits(service.id) })
  const unitsQuery = useQuery({ queryKey: ['inventory', 'units'], queryFn: getUnits })
  const [unitId, setUnitId] = useState(0)
  const [factor, setFactor] = useState('')
  const [removing, setRemoving] = useState<{ id: number; unit: string } | null>(null)

  const list = listQuery.data
  const rootUnit = list?.rootUnit || service.unit
  const rows = list?.rows ?? []
  const taken = new Set(rows.map((r) => r.unitId))
  const available = (unitsQuery.data?.rows ?? []).filter((u) => u.isActive === 1 && !taken.has(u.id))
  const picked = available.find((u) => u.id === unitId)
  const parsed = parseUnitFactor(factor)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: unitsKey(service.id) })

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!picked || parsed === null) throw new Error('Dữ liệu chưa hợp lệ.')
      return saveConvertUnit({ serviceId: service.id, unitId: picked.id, quantity: parsed })
    },
    onSuccess: (result) => {
      pushToast(`Đã lưu quy đổi: ${unitFactorText(result.unit, result.quantity, rootUnit)}.`, 'success')
      setUnitId(0)
      setFactor('')
      refresh()
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })
  const removeMutation = useMutation({
    mutationFn: (id: number) => removeConvertUnit(id),
    onSuccess: () => {
      pushToast('Đã xoá đơn vị quy đổi.', 'success')
      setRemoving(null)
      refresh()
    },
    onError: (error) => {
      setRemoving(null)
      pushToast(describeInventoryError(error), 'error')
    },
  })

  return (
    <>
      <Dialog
        open
        title={`Đơn vị quy đổi — ${service.name}`}
        description={`Đơn vị gốc của mặt hàng: ${rootUnit || '—'}. Tồn kho luôn lưu theo đơn vị gốc.`}
        onClose={saveMutation.isPending || removeMutation.isPending || removing ? () => undefined : onClose}
        footer={
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        <div className="inv-units">
          {listQuery.isLoading ? (
            <StateView title="Đang tải…" />
          ) : listQuery.isError ? (
            <StateView title="Không tải được đơn vị quy đổi" description={describeInventoryError(listQuery.error)} />
          ) : list?.supported === false ? (
            <StateView title="Cơ sở dữ liệu chưa có bảng đơn vị quy đổi" />
          ) : (
            <div className="inv-table-wrap">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Đơn vị</th>
                    <th>Quy đổi</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.id}-${r.unitId}`}>
                      <td>
                        <strong>{r.unit}</strong>{' '}
                        {r.root ? (
                          <StatusBadge tone="info" dot={false}>
                            Đơn vị gốc
                          </StatusBadge>
                        ) : null}
                      </td>
                      <td>{unitFactorText(r.unit, r.quantity, rootUnit)}</td>
                      <td className="inv-table__actions">
                        {r.root ? null : (
                          <Button
                            type="button"
                            variant="danger-outline"
                            disabled={!canEdit}
                            title={canEdit ? undefined : 'Cần quyền Quản lý đơn vị quy đổi (65)'}
                            onClick={() => setRemoving({ id: r.id, unit: r.unit })}
                          >
                            Xoá
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="inv-block">
            <h3>Thêm đơn vị quy đổi</h3>
            <div className="inv-form">
              <label className="ds-field">
                <span className="ds-field__label">Đơn vị</span>
                <Select aria-label="Đơn vị quy đổi" disabled={!canEdit} value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
                  <option value={0}>— Chọn đơn vị —</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unit}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="ds-field">
                <span className="ds-field__label">Số {rootUnit || 'đơn vị gốc'} trong 1 đơn vị này (từ 2)</span>
                <input
                  className="ds-input"
                  inputMode="numeric"
                  disabled={!canEdit}
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                />
              </label>
              <p className="inv-muted inv-form__wide">
                {picked && parsed !== null
                  ? `Sẽ lưu: ${unitFactorText(picked.unit, parsed, rootUnit)}.`
                  : `Ví dụ: 1 thùng = 24 ${rootUnit || 'đơn vị gốc'}. Khi nhập kho bằng đơn vị này, tồn tăng theo đơn vị gốc.`}
              </p>
              <div className="inv-form__wide">
                <Button
                  type="button"
                  variant="primary"
                  loading={saveMutation.isPending}
                  disabled={!canEdit || !picked || parsed === null}
                  title={canEdit ? undefined : 'Cần quyền Quản lý đơn vị quy đổi (65)'}
                  onClick={() => saveMutation.mutate()}
                >
                  Thêm đơn vị quy đổi
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Dialog>
      <ConfirmAction
        open={removing !== null}
        title={`Xoá quy đổi [${removing?.unit ?? ''}]?`}
        description="Chỉ xoá hệ số quy đổi của mặt hàng này. Phiếu nhập đã ghi không bị ảnh hưởng."
        confirmLabel="Xoá"
        danger
        pending={removeMutation.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && removeMutation.mutate(removing.id)}
      />
    </>
  )
}
