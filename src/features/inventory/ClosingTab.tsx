import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  commitClosing,
  getClosingDetail,
  getClosingPreview,
  getMaterials,
  listClosings,
  type ClosingLine,
  type MaterialRow,
} from '../../api/inventory'
import {
  Button,
  ConfirmAction,
  DateRangePicker,
  InlineAlert,
  ListToolbar,
  RefreshButton,
  Select,
  SortHeaderCell,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { ClosingPreviewToggle } from './ClosingPreviewToggle'
import { defaultReportRange, formatDateTimeText } from './finishedStockModel'
import { sortRows, toSortNumber, type SortDirection, type SortState, type SortValue } from '../../lib/tableSort'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  closingsInRange,
  dateFilter,
  describeInventoryError,
  diffTone,
  formatDiff,
  formatQty,
  previewHasDiff,
} from './inventoryModel'

type DetailSortKey = 'opening' | 'import' | 'export' | 'usage' | 'adjust' | 'expected' | 'closing' | 'diff'
/** Cột Thời điểm chốt sắp theo NHÓM (kỳ); các cột số sắp các dòng nguyên liệu TRONG từng kỳ. */
type ClosingSortKey = DetailSortKey | 'time'

const DETAIL_SORT: Record<DetailSortKey, (r: ClosingLine) => SortValue> = {
  opening: (r) => toSortNumber(r.openingQty),
  import: (r) => toSortNumber(r.importQty),
  export: (r) => toSortNumber(r.exportQty),
  usage: (r) => toSortNumber(r.usageQty),
  adjust: (r) => toSortNumber(r.adjustQty),
  expected: (r) => toSortNumber(r.expectedQty),
  closing: (r) => toSortNumber(r.closingQty),
  diff: (r) => toSortNumber(r.diffQty),
}

/** Tối đa bao nhiêu kỳ đã chốt được tải chi tiết cùng lúc (mỗi kỳ 1 lượt gọi; kỳ đã chốt bất biến nên được giữ trong bộ nhớ đệm). */
const MAX_PERIODS = 30

/** Kết quả sẽ ghi lúc chốt từ xem-trước kỳ đang mở, cùng hình dạng với dòng của kỳ đã chốt (Cuối kỳ = tồn thực lúc chốt). */
function previewToLines(rows: readonly MaterialRow[]): ClosingLine[] {
  return rows.map((m) => ({
    materialId: m.materialId,
    materialName: m.name,
    unit: m.unit,
    openingQty: m.openingQty ?? '0',
    importQty: m.importQty ?? '0',
    exportQty: m.exportQty ?? '0',
    usageQty: m.usageQty ?? '0',
    adjustQty: m.adjustQty ?? '0',
    expectedQty: m.expectedQty ?? '0',
    closingQty: m.stockQty,
    diffQty: m.diffQty ?? '0',
  }))
}

const lineHasDiff = (l: ClosingLine) => {
  const n = toSortNumber(l.diffQty)
  return n !== null && n !== 0
}

/** "2026-11-20 14:54:56" → "20/11/2026 14:54:56" (cùng cách hiện thời điểm của báo cáo Chốt kho hàng hóa). */
function formatStamp(value: string): string {
  const [date, time = ''] = value.split(' ')
  return formatDateTimeText(date, time)
}

type PeriodGroup = {
  key: string
  /** Kỳ đang mở (xem trước, chưa ghi) — luôn đứng đầu bảng. */
  open: boolean
  title: string
  /** Đầu kỳ; null = từ đầu. */
  from: string | null
  staffName: string
  note: string
  lines: ClosingLine[]
}

/**
 * Tab Chốt kỳ: MỘT bảng gom theo kỳ (giống tab Chốt kho của kho hàng hóa) — đầu bảng là kỳ đang mở (xem trước), dưới là các kỳ
 * đã chốt trong khoảng ngày (mặc định 1 tháng), lọc được theo nguyên liệu. Mỗi kỳ: ô Thời điểm chốt + Người chốt gộp dọc, ghi
 * chú ngay dưới hai ô đó. Chốt = ghi bản chụp bất biến (materialclosingtb), KHÔNG đổi tồn. Quyền 68.
 */
export function ClosingTab() {
  // Mặc định lùi 1 tháng → hôm nay (giống báo cáo kho hàng hóa); chỉ lọc các kỳ ĐÃ chốt, kỳ đang mở luôn hiện.
  const [defaultRange] = useState(() => defaultReportRange())
  const [fromDate, setFromDate] = useState(defaultRange.fromDate)
  const [toDate, setToDate] = useState(defaultRange.toDate)
  const [materialId, setMaterialId] = useState(0)
  // Lọc theo người chốt (chỉ áp cho kỳ ĐÃ chốt; kỳ đang mở chưa ai chốt nên bị ẩn khi đang lọc người).
  const [staffId, setStaffId] = useState(0)
  const [sort, setSort] = useState<SortState<ClosingSortKey>>(null)

  const previewQuery = useQuery({ queryKey: ['inventory', 'closing', 'preview'], queryFn: getClosingPreview })
  const listQuery = useQuery({
    queryKey: ['inventory', 'closing', 'list'],
    queryFn: () => listClosings({ limit: 500 }),
  })
  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })

  const preview = previewQuery.data
  const hasPeriod = preview?.period !== undefined

  // Kỳ đã chốt trong khoảng ngày (mới nhất trước), tải chi tiết từng kỳ (bất biến ⇒ giữ mãi trong bộ nhớ đệm).
  const allClosings = listQuery.data?.rows ?? []
  // Danh sách người chốt cho combo: những người đã từng chốt (lấy từ lịch sử kỳ, không cần quyền xem nhân viên).
  const staffOptions = [...new Map(allClosings.map((c) => [c.staffId, c.staffName || `#${c.staffId}`])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], 'vi'),
  )
  const inRange = closingsInRange(allClosings, dateFilter(fromDate) ?? '', dateFilter(toDate) ?? '').filter(
    (c) => staffId === 0 || c.staffId === staffId,
  )
  const shown = inRange.slice(0, MAX_PERIODS)
  const detailQueries = useQueries({
    queries: shown.map((c) => ({
      queryKey: ['inventory', 'closing', 'detail', c.closingId],
      queryFn: () => getClosingDetail(c.closingId),
      staleTime: Infinity,
    })),
  })
  const detailLoading = detailQueries.some((q) => q.isLoading)
  const detailFailed = detailQueries.some((q) => q.isError)

  const keep = (l: ClosingLine) => materialId === 0 || l.materialId === materialId
  const closedGroups: PeriodGroup[] = []
  shown.forEach((c, index) => {
    const detail = detailQueries[index]?.data
    if (!detail) return
    const lines = detail.rows.filter(keep)
    if (materialId !== 0 && lines.length === 0) return
    closedGroups.push({
      key: `c${c.closingId}`,
      open: false,
      title: formatStamp(c.createDate),
      from: c.fromDate,
      staffName: c.staffName,
      note: c.note,
      lines,
    })
  })
  const openLines = preview && preview.supported !== false ? previewToLines(preview.rows).filter(keep) : []
  const openGroup: PeriodGroup | null =
    openLines.length > 0 && staffId === 0
      ? {
          key: 'open',
          open: true,
          title: hasPeriod ? 'Kỳ đang mở' : 'Tồn hiện tại',
          from: preview?.period?.fromDate ?? null,
          staffName: '',
          note: '',
          lines: openLines,
        }
      : null

  // Kỳ đang mở luôn đứng đầu; sắp theo Thời điểm chốt chỉ đảo thứ tự các kỳ đã chốt.
  const orderedClosed = sort?.key === 'time' ? sortClosedByTime(closedGroups, sort.dir) : closedGroups
  const groups = [...(openGroup ? [openGroup] : []), ...orderedClosed]
  const rowSort =
    sort && sort.key !== 'time' ? ({ key: sort.key, dir: sort.dir } as { key: DetailSortKey; dir: SortDirection }) : null

  const hasFilter =
    materialId !== 0 || staffId !== 0 || fromDate !== defaultRange.fromDate || toDate !== defaultRange.toDate
  const loading = previewQuery.isLoading || listQuery.isLoading
  const error = previewQuery.isError ? previewQuery.error : listQuery.isError ? listQuery.error : null
  const refetchAll = () => {
    void previewQuery.refetch()
    void listQuery.refetch()
  }

  return (
    <div className="inv-stack">
      <section className="inv-panel" aria-label="Chốt kỳ kho nguyên liệu">
        <div className="inv-filters inv-filters--report">
          <DateRangePicker
            label="Khoảng ngày"
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
          />
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Nguyên liệu</span>
            <Select
              searchable
              aria-label="Lọc theo nguyên liệu"
              value={materialId}
              onChange={(e) => setMaterialId(Number(e.target.value))}
            >
              <option value={0}>Tất cả</option>
              {(materialsQuery.data?.rows ?? []).map((m) => (
                <option key={m.materialId} value={m.materialId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Người chốt</span>
            <Select
              searchable
              aria-label="Lọc theo người chốt"
              value={staffId}
              onChange={(e) => setStaffId(Number(e.target.value))}
            >
              <option value={0}>Tất cả</option>
              {staffOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          {hasFilter ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMaterialId(0)
                setStaffId(0)
                setFromDate(defaultRange.fromDate)
                setToDate(defaultRange.toDate)
              }}
            >
              Xóa bộ lọc
            </Button>
          ) : null}
        </div>

        <ListToolbar
          count={
            <>
              Tổng <strong>{closedGroups.length}</strong> kỳ đã chốt
              {inRange.length > MAX_PERIODS ? ` (hiện ${MAX_PERIODS} kỳ gần nhất trong khoảng)` : ''}
            </>
          }
          actions={
            <>
              <RefreshButton loading={previewQuery.isFetching || listQuery.isFetching} onClick={refetchAll} />
              <ClosingCommitButton />
            </>
          }
        />

        {loading ? (
          <StateView title="Đang tải…" />
        ) : error ? (
          <StateView
            title="Không tải được kỳ chốt"
            description={describeInventoryError(error)}
            action={
              <Button type="button" onClick={refetchAll}>
                Thử lại
              </Button>
            }
          />
        ) : preview?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có bảng nguyên liệu" />
        ) : (
          <>
            {!hasPeriod ? (
              <InlineAlert tone="warning">
                Cơ sở dữ liệu chưa có bảng chốt kỳ nên chưa chốt được; đang hiển thị tồn hiện tại.
              </InlineAlert>
            ) : null}
            {detailFailed ? (
              <InlineAlert tone="warning">Có kỳ chưa tải được chi tiết — bấm làm mới để thử lại.</InlineAlert>
            ) : null}
            {detailLoading ? <p className="inv-closing-preview__hint">Đang tải chi tiết các kỳ đã chốt…</p> : null}
            {groups.length === 0 ? (
              <StateView
                title={listQuery.data?.supported === false ? 'Cơ sở dữ liệu chưa có bảng chốt kỳ' : 'Không có kỳ nào'}
                description={hasFilter ? 'Thử đổi khoảng ngày hoặc nguyên liệu.' : 'Chưa chốt kỳ nào.'}
              />
            ) : (
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <SortHeaderCell label="Thời điểm chốt" sortKey="time" sort={sort} onSort={setSort} firstDir="desc" />
                      <th>Người chốt</th>
                      <th>Nguyên liệu</th>
                      <SortHeaderCell label="Đầu kỳ" sortKey="opening" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Nhập" sortKey="import" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Xuất" sortKey="export" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Tiêu hao" sortKey="usage" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Kiểm kê" sortKey="adjust" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Dự kiến" sortKey="expected" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Cuối kỳ" sortKey="closing" sort={sort} onSort={setSort} className="is-num" />
                      <SortHeaderCell label="Lệch" sortKey="diff" sort={sort} onSort={setSort} className="is-num" />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const lines = rowSort ? sortRows(group.lines, rowSort, DETAIL_SORT) : group.lines
                      const diffLines = group.lines.filter(lineHasDiff).length
                      // Kỳ ≥ 2 dòng có ghi chú: hai ô gộp chỉ chiếm DÒNG ĐẦU, ghi chú ngay dưới (gộp 2 cột) ⇒ luôn ở đầu kỳ.
                      const noteRow = group.note !== '' && lines.length >= 2
                      const headSpan = noteRow ? 1 : lines.length
                      return lines.map((r, index) => (
                        <tr key={`${group.key}-${r.materialId}`} className={index === 0 ? 'is-group-start' : undefined}>
                          {index === 0 ? (
                            <>
                              <td className="inv-group-cell" rowSpan={headSpan}>
                                <strong>{group.title}</strong>
                                <small className="inv-muted">
                                  Từ {group.from ? formatStamp(group.from) : 'đầu'}
                                  {group.open ? ' → hiện tại' : ''}
                                </small>
                                <small className="inv-muted">
                                  {group.lines.length} nguyên liệu · {diffLines} lệch
                                </small>
                                {group.note !== '' && !noteRow ? (
                                  <small className="inv-group-note">Ghi chú: {group.note}</small>
                                ) : null}
                              </td>
                              <td className="inv-group-cell" rowSpan={headSpan}>
                                {group.open ? <span className="inv-muted">—</span> : group.staffName}
                              </td>
                            </>
                          ) : null}
                          {noteRow && index === 1 ? (
                            <td className="inv-group-cell inv-group-note" colSpan={2} rowSpan={lines.length - 1} title={group.note}>
                              Ghi chú: {group.note}
                            </td>
                          ) : null}
                          <td>
                            {r.materialName} <span className="inv-muted">{r.unit}</span>
                          </td>
                          <td className="is-num">{formatQty(r.openingQty)}</td>
                          <td className="is-num">{formatQty(r.importQty)}</td>
                          <td className="is-num">{formatQty(r.exportQty)}</td>
                          <td className="is-num">{formatQty(r.usageQty)}</td>
                          <td className="is-num">{formatDiff(r.adjustQty)}</td>
                          <td className="is-num">{formatQty(r.expectedQty)}</td>
                          <td className="is-num">
                            <strong>{formatQty(r.closingQty)}</strong>
                          </td>
                          <td className="is-num">
                            <StatusBadge tone={diffTone(r.diffQty)} dot={false}>
                              {formatDiff(r.diffQty)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** Sắp các kỳ đã chốt theo thời điểm (key `c<closingId>`: id tăng dần theo thời gian chốt); mới nhất trước khi `desc`. */
function sortClosedByTime(groups: PeriodGroup[], dir: SortDirection): PeriodGroup[] {
  const id = (g: PeriodGroup) => Number(g.key.slice(1))
  return [...groups].sort((a, b) => (dir === 'asc' ? id(a) - id(b) : id(b) - id(a)))
}

/**
 * Nút "Chốt kỳ" + hộp xác nhận (ghi chú tuỳ chọn). Dùng chung cho tab Chốt kỳ và mục Tồn kho; đọc xem-trước kỳ đang mở qua cùng
 * khoá truy vấn nên không tốn thêm lượt gọi máy chủ. Quyền 68.
 */
export function ClosingCommitButton() {
  const queryClient = useQueryClient()
  const canClose = useAuthStore((s) => s.hasRight)(68)
  const { getKey, clearKey } = useIdempotentIntent('closing')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [note, setNote] = useState('')
  const previewQuery = useQuery({ queryKey: ['inventory', 'closing', 'preview'], queryFn: getClosingPreview })
  const rows = previewQuery.data?.rows ?? []
  const hasPeriod = previewQuery.data?.period !== undefined
  const diffCount = rows.filter(previewHasDiff).length
  // Kết quả sẽ ghi lúc chốt, cùng hình dạng với bảng Chi tiết của kỳ đã chốt (Cuối kỳ = tồn thực lúc chốt); dòng đang lệch lên trước.
  const previewRows: ClosingLine[] = previewToLines([...rows].sort((a, b) => Number(previewHasDiff(b)) - Number(previewHasDiff(a))))

  const commit = useMutation({
    mutationFn: () => commitClosing({ note: note.trim() || undefined, idem: getKey(note.trim()) }),
    onSuccess: (result) => {
      clearKey()
      pushToast(
        `Đã chốt kỳ #${result.closingId}: ${result.materialCount} nguyên liệu, ${result.diffCount} dòng lệch.`,
        'success',
      )
      setConfirmOpen(false)
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={!canClose || !hasPeriod || rows.length === 0}
        title={canClose ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
        onClick={() => setConfirmOpen(true)}
      >
        Chốt kỳ
      </Button>
      <ConfirmAction
        open={confirmOpen}
        title="Chốt kỳ kho nguyên liệu?"
        description="Ghi bản chụp tồn đầu/cuối kỳ để đối chiếu; không đổi số tồn."
        confirmLabel="Chốt kỳ"
        size="md"
        pending={commit.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => commit.mutate()}
      >
        <div className="inv-form inv-form--closing inv-form--closing-wide">
          <p className="inv-form__wide">
            <strong>{rows.length}</strong> nguyên liệu · <strong>{diffCount}</strong> dòng lệch so với dự kiến.
          </p>
          <label className="ds-field inv-form__wide">
            <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
            <input className="ds-input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ClosingPreviewToggle count={previewRows.length}>
            <p className="inv-closing-preview__hint">Kết quả cuối cùng sẽ ghi vào kỳ (giống bảng Chi tiết của kỳ đã chốt).</p>
            <DetailTable rows={previewRows} />
          </ClosingPreviewToggle>
        </div>
      </ConfirmAction>
    </>
  )
}

/**
 * Thanh kỳ ở mục Tồn kho của kho nguyên liệu: "Kỳ đang mở: <đầu kỳ> → hiện tại" + nút Chốt kỳ (giống kho hàng hóa). Chưa có bảng
 * chốt kỳ (máy chủ không trả `period`) ⇒ không hiện dòng kỳ, nút Chốt kỳ bị khoá như ở tab Chốt kỳ.
 */
export function ClosingPeriodBar() {
  const previewQuery = useQuery({ queryKey: ['inventory', 'closing', 'preview'], queryFn: getClosingPreview })
  const period = previewQuery.data?.period
  return (
    <>
      {period ? (
        <span className="inv-closing-period" title="Từ lần chốt kỳ gần nhất đến hiện tại">
          Kỳ đang mở: <strong>{period.fromDate ?? 'từ đầu'}</strong> → <strong>hiện tại</strong>
        </span>
      ) : null}
      <ClosingCommitButton />
    </>
  )
}

function DetailTable({ rows }: { rows: ClosingLine[] }) {
  const [sort, setSort] = useState<SortState<DetailSortKey>>(null)
  if (rows.length === 0) return <StateView title="Kỳ này không có dòng nào" />
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Nguyên liệu</th>
            <SortHeaderCell label="Đầu kỳ" sortKey="opening" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Nhập" sortKey="import" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Xuất" sortKey="export" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Tiêu hao" sortKey="usage" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Kiểm kê" sortKey="adjust" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Dự kiến" sortKey="expected" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Cuối kỳ" sortKey="closing" sort={sort} onSort={setSort} className="is-num" />
            <SortHeaderCell label="Lệch" sortKey="diff" sort={sort} onSort={setSort} className="is-num" />
          </tr>
        </thead>
        <tbody>
          {sortRows(rows, sort, DETAIL_SORT).map((r) => (
            <tr key={r.materialId}>
              <td>
                {r.materialName} <span className="inv-muted">{r.unit}</span>
              </td>
              <td className="is-num">{formatQty(r.openingQty)}</td>
              <td className="is-num">{formatQty(r.importQty)}</td>
              <td className="is-num">{formatQty(r.exportQty)}</td>
              <td className="is-num">{formatQty(r.usageQty)}</td>
              <td className="is-num">{formatDiff(r.adjustQty)}</td>
              <td className="is-num">{formatQty(r.expectedQty)}</td>
              <td className="is-num">
                <strong>{formatQty(r.closingQty)}</strong>
              </td>
              <td className="is-num">
                <StatusBadge tone={diffTone(r.diffQty)} dot={false}>
                  {formatDiff(r.diffQty)}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
