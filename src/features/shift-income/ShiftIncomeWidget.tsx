import { useQuery } from '@tanstack/react-query'
import { CaretDown, CaretRight, CreditCard, Funnel, HandCoins, Money, QrCode } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fetchDynamicReport } from '../../api/dynamic-reports'
import { useNavBadge } from '../../layouts/useNavBadge'
import { useAuthStore } from '../../store/auth'
import { useRevenuePrefs } from '../../store/revenuePrefs'
import { REPORT_PAGES } from '../reports/reportCatalog'
import {
  availableMethods,
  buildShiftIncome,
  formatCompact,
  formatVnd,
  maxCell,
  MANDATORY_METHODS,
  MANDATORY_SOURCES,
  METHOD_LABEL,
  rolling24hWindow,
  ROW_KEYS,
  selectSources,
  sortSources,
  sumSelected,
  summarize,
  type IncomePart,
  type MethodKey,
  type MethodSelection,
  type RowKey,
  type SortKey,
  type SourceKey,
  type SourceSelection,
} from './shiftIncomeModel'
import './shift-income.css'

const METHOD_ICON: Record<MethodKey, typeof Money> = {
  cash: Money,
  bank: CreditCard,
  qr: QrCode,
  deduct: HandCoins,
}

// Quyền xem báo cáo ca: lấy từ catalog để khỏi lệch với trang /reports/shift-report.
const VIEW_RIGHT = REPORT_PAGES.find((page) => page.id === 'shift-report')?.viewRight

// Chế độ mock — chỉ có khi `npm run dev` VÀ có VITE_SHIFT_INCOME_MOCK trong `.env.development.local`
// (1 | deduct | empty | error | loading | slow, xem ./shiftIncomeMock.ts). Bản build luôn là undefined.
const rawMock = import.meta.env.DEV ? (import.meta.env.VITE_SHIFT_INCOME_MOCK as string | undefined) : undefined
const MOCK_MODE = rawMock && rawMock !== '0' ? rawMock : undefined

const OPEN_STORAGE_KEY = 'fnet-shift-income-open'
const METHODS_STORAGE_KEY = 'fnet-shift-income-methods'
const SOURCES_STORAGE_KEY = 'fnet-shift-income-sources'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(value: boolean) {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // trình duyệt chặn storage: chỉ mất nhớ trạng thái mở/gọn, không ảnh hưởng số liệu.
  }
}

/**
 * Đọc bộ cờ chọn đã lưu; khóa thiếu/hỏng = true (tính vào tổng) để mục mới thêm sau này mặc định được tính.
 * Mục BẮT BUỘC (`locked`) luôn true, kể cả khi giá trị lưu từ phiên bản trước là false.
 */
function readFlags<K extends string>(
  storageKey: string,
  keys: readonly K[],
  locked: readonly string[],
): Record<K, boolean> {
  let parsed: Partial<Record<K, unknown>> | null = null
  try {
    parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Record<K, unknown>> | null
  } catch {
    parsed = null
  }
  return Object.fromEntries(
    keys.map((key) => [key, locked.includes(key) || parsed?.[key] !== false]),
  ) as Record<K, boolean>
}

function writeFlags(storageKey: string, value: Record<string, boolean>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // như writeOpen: chỉ mất nhớ lựa chọn.
  }
}

// Ước lượng bề rộng chữ 0.6875rem đậm trên thanh dày (thanh rộng ~190px ở sidebar 15rem: 218px trừ nút bung chi tiết
// 24px và khe 4px bên cạnh) để biết đoạn nào chứa nổi "N%", chỉ chứa nổi số N, hay không chứa nổi gì.
const BAR_WIDTH_PX = 190
const DIGIT_PX = 6.2
const PERCENT_SIGN_PX = 8.5
const LABEL_PADDING_PX = 2

type BarSegment = { key: string; className: string; share: number; title?: string }

/** Thanh tỷ trọng (stacked bar) DÀY, số % nằm trong từng đoạn (dùng cho nguồn thu). */
function StackedBar({ segments, ariaLabel }: { segments: BarSegment[]; ariaLabel: string }) {
  const label = (segment: BarSegment) => {
    const percent = Math.round(segment.share * 100)
    // Đủ chỗ thì "N%", hẹp hơn thì chỉ số, hẹp nữa thì để trống (xem số ở danh sách bên dưới).
    const room = segment.share * BAR_WIDTH_PX - LABEL_PADDING_PX
    const digitsWidth = String(percent).length * DIGIT_PX
    if (percent < 1 || room < digitsWidth) return ''
    return room >= digitsWidth + PERCENT_SIGN_PX ? `${percent}%` : String(percent)
  }
  return (
    <div className="shift-income__stack">
      <div className="shift-income__bar shift-income__bar--thick" role="img" aria-label={ariaLabel}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={segment.className}
            title={segment.title}
            style={{ width: `${segment.share * 100}%` }}
          >
            {label(segment)}
          </span>
        ))}
      </div>
    </div>
  )
}

type PieSegment = { key: MethodKey; share: number; title: string }

// Biểu đồ tròn vẽ bằng SVG thuần: mỗi đoạn là 1 hình quạt (<path> M tâm -> L điểm đầu -> A cung -> Z), bắt đầu từ
// 12 giờ, chạy thuận chiều kim đồng hồ. (Không dùng vòng tròn nét dày + stroke-dasharray: nét dày đúng bằng đường kính
// thì mép trong co về tâm và trình duyệt vẽ thủng 1 mảng ở giữa.)
const PIE_CENTER = 16
const PIE_RADIUS = 16
const pieAngle = (fraction: number) => 2 * Math.PI * fraction - Math.PI / 2
const piePoint = (fraction: number) =>
  `${(PIE_CENTER + PIE_RADIUS * Math.cos(pieAngle(fraction))).toFixed(3)} ${(PIE_CENTER + PIE_RADIUS * Math.sin(pieAngle(fraction))).toFixed(3)}`

/** Biểu đồ tròn nhỏ tỷ trọng phương thức thanh toán; màu theo .si-m-*, tooltip từng đoạn qua <title>. */
function MethodPie({ segments }: { segments: PieSegment[] }) {
  // Chỉ một phương thức có tiền (hoặc chưa có đồng nào): tỷ trọng là 100%/trống, biểu đồ không có ý nghĩa nên ẩn.
  if (segments.filter((segment) => segment.share > 0).length < 2) return null
  let start = 0
  return (
    <svg
      className="shift-income__pie"
      viewBox="0 0 32 32"
      role="img"
      aria-label="Tỷ trọng phương thức thanh toán"
    >
      <circle className="shift-income__pie-track" cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS} />
      {segments.map((segment) => {
        const share = Math.min(Math.max(segment.share, 0), 1)
        if (share <= 0) return null
        const from = start
        start += share
        const className = `shift-income__pie-seg si-m-${segment.key}`
        // Đoạn chiếm trọn hình: cung đầu trùng cung cuối nên <path> không vẽ được, dùng hình tròn.
        if (share >= 0.9999) {
          return (
            <circle key={segment.key} className={className} cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS}>
              <title>{segment.title}</title>
            </circle>
          )
        }
        const d = `M ${PIE_CENTER} ${PIE_CENTER} L ${piePoint(from)} A ${PIE_RADIUS} ${PIE_RADIUS} 0 ${
          share > 0.5 ? 1 : 0
        } 1 ${piePoint(from + share)} Z`
        return (
          <path key={segment.key} className={className} d={d}>
            <title>{segment.title}</title>
          </path>
        )
      })}
    </svg>
  )
}

/** Dòng phương thức: từ chừng này cặp trở xuống thì còn chỗ ghi thêm tên ("Tiền mặt", "QR") cạnh icon; nhiều hơn thì chỉ icon. */
const MAX_METHODS_WITH_LABEL = 2

/**
 * Một cặp <icon> <số tiền> của dòng phương thức (ít cặp thì <icon> <tên> <số tiền>). Số đổi so với lần trước thì chớp 10 giây, cùng hook + keyframes
 * (nav-heartbeat) với chấm số ở menu trái; lần hiện đầu tiên không chớp.
 */
function MethodAmount({ method, amount, showLabel }: { method: MethodKey; amount: number; showLabel: boolean }) {
  const pulse = useNavBadge(Math.round(amount))
  const Icon = METHOD_ICON[method]
  return (
    <li
      className={`si-m-${method}${pulse.pulsing ? ' is-pulsing' : ''}`}
      title={`${METHOD_LABEL[method]}: ${formatVnd(amount)} đ`}
      aria-label={`${METHOD_LABEL[method]}: ${formatVnd(amount)} đồng`}
    >
      <Icon className="shift-income__icon" size={14} weight="bold" aria-hidden="true" />
      {showLabel ? <span className="shift-income__method-name">{METHOD_LABEL[method]}</span> : null}
      <span className="shift-income__method-amount">{formatCompact(amount)}</span>
    </li>
  )
}

/** Một dòng nguồn thu (chấm màu, tên, số lượt, số tiền). Số tiền đổi thì cả dòng chớp 10 giây, giống MethodAmount. */
function SourceAmount({
  sourceKey,
  name,
  count,
  amount,
}: {
  sourceKey: SourceKey
  name: string
  count: number
  amount: number
}) {
  const pulse = useNavBadge(Math.round(amount))
  return (
    <li className={`si-s-${sourceKey}${pulse.pulsing ? ' is-pulsing' : ''}`}>
      <span className="shift-income__row-dot" aria-hidden="true" />
      <span className="shift-income__method-label">{name}</span>
      <span className="shift-income__method-count" title={`${name}: ${count} lượt thu`}>
        {count}
      </span>
      <span className="shift-income__method-amount">{formatVnd(amount)}</span>
    </li>
  )
}

type BaseMethod = Exclude<MethodKey, 'deduct'>
const BASE_METHODS: readonly BaseMethod[] = ['cash', 'bank', 'qr']

export function ShiftIncomeWidget() {
  const staffId = useAuthStore((state) => state.staffId)
  const canView = useAuthStore((state) =>
    MOCK_MODE ? true : VIEW_RIGHT === undefined ? false : state.hasRight(VIEW_RIGHT),
  )
  const enabled = canView && staffId !== null && staffId > 0

  const [open, setOpen] = useState(readOpen)
  const [sort, setSort] = useState<SortKey>('total')
  // Nguồn gộp đang mở rộng; chỉ nhớ trong phiên làm việc (xem chi tiết khi cần, không phải cài đặt).
  const [expandedSources, setExpandedSources] = useState<SourceKey[]>([])
  const [baseMethods, setBaseMethods] = useState(() => readFlags(METHODS_STORAGE_KEY, BASE_METHODS, MANDATORY_METHODS))
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>(() =>
    readFlags(SOURCES_STORAGE_KEY, ROW_KEYS, MANDATORY_SOURCES),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  // Cấn trừ dùng CHUNG tuỳ chọn với thẻ "Doanh thu" của trang Đơn dịch vụ / Đặt máy / bán COMBO.
  const deductInRevenue = useRevenuePrefs((state) => state.deductInRevenue)
  const setDeductInRevenue = useRevenuePrefs((state) => state.setDeductInRevenue)

  const query = useQuery({
    queryKey: ['shift-income', staffId],
    queryFn: async () => {
      const window = rolling24hWindow(new Date())
      let rows: unknown
      if (MOCK_MODE) {
        // import động: nhánh này bị loại khỏi bản build vì MOCK_MODE luôn undefined ở PROD.
        const { mockShiftIncomeRows } = await import('./shiftIncomeMock')
        rows = await mockShiftIncomeRows(MOCK_MODE)
      } else {
        rows = await fetchDynamicReport({
          type: 43,
          staffid: staffId ?? 0,
          from_date: window.fromDate,
          from_time: window.fromTime,
          to_date: window.toDate,
        })
      }
      return { income: buildShiftIncome(rows), sinceLabel: window.sinceLabel }
    },
    enabled,
    refetchInterval: 30_000,
    retry: false,
  })

  // Đóng bảng cài đặt khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsOpen])

  const income = query.data?.income ?? null
  const methodSelection = useMemo<MethodSelection>(
    () => ({ ...baseMethods, deduct: deductInRevenue }),
    [baseMethods, deductInRevenue],
  )
  const methods = useMemo(() => (income ? availableMethods(income) : []), [income])
  // Nguồn đã áp checklist: khoản bỏ chọn biến mất khỏi nhóm lẫn tổng.
  const sources = useMemo(() => (income ? selectSources(income, sourceSelection) : []), [income, sourceSelection])
  const summary = useMemo(
    () => (income ? summarize(sources, methods, methodSelection) : null),
    [income, sources, methods, methodSelection],
  )
  // Hình thức bỏ chọn BIẾN MẤT khỏi widget (chỉ còn trong bảng cài đặt để bật lại) cho đỡ rối.
  const visibleMethods = useMemo(() => methods.filter((key) => methodSelection[key]), [methods, methodSelection])
  // Đang sắp theo một hình thức vừa bị ẩn thì quay về sắp theo tổng.
  const activeSort: SortKey = sort !== 'total' && !visibleMethods.includes(sort) ? 'total' : sort
  const visibleSources = useMemo(
    () => sortSources(sources, activeSort, methods, methodSelection),
    [sources, activeSort, methods, methodSelection],
  )
  const heatMax = useMemo(() => maxCell(visibleSources, visibleMethods), [visibleSources, visibleMethods])

  if (!enabled) return null

  const toggleOpen = () => {
    setOpen((value) => {
      writeOpen(!value)
      return !value
    })
  }
  const pickSort = (key: MethodKey) => setSort((current) => (current === key ? 'total' : key))
  const toggleExpanded = (key: SourceKey) =>
    setExpandedSources((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]))
  const toggleSource = (key: RowKey) => {
    if (MANDATORY_SOURCES.includes(key)) return
    setSourceSelection((current) => {
      const next = { ...current, [key]: !current[key] }
      writeFlags(SOURCES_STORAGE_KEY, next)
      return next
    })
  }
  const renderCells = (part: IncomePart) => (
    <div className="shift-income__cells">
      {visibleMethods.map((key) => {
        const value = part[key]
        const style =
          value > 0 && heatMax > 0
            ? ({ '--heat': `${Math.round(10 + (26 * value) / heatMax)}%` } as CSSProperties)
            : undefined
        return (
          <span
            key={key}
            className={`shift-income__cell si-m-${key}${value > 0 ? '' : ' is-nil'}`}
            style={style}
            title={`${METHOD_LABEL[key]}: ${value > 0 ? `${formatVnd(value)} đ` : 'không có'}`}
          >
            {formatCompact(value)}
          </span>
        )
      })}
    </div>
  )
  const toggleMethod = (key: MethodKey) => {
    if (MANDATORY_METHODS.includes(key)) return
    if (key === 'deduct') {
      setDeductInRevenue(!deductInRevenue)
      return
    }
    setBaseMethods((current) => {
      const next = { ...current, [key]: !current[key] }
      writeFlags(METHODS_STORAGE_KEY, next)
      return next
    })
  }

  if (!income || !summary) {
    return (
      <section className="shift-income" aria-label="Doanh thu" aria-busy={query.isPending}>
        <div className="shift-income__head">
          <span className="shift-income__title">Doanh thu</span>
        </div>
        {query.isError || query.data ? (
          <div className="shift-income__error" role="alert">
            <span>Không tải được số liệu.</span>
            <button type="button" className="shift-income__retry" onClick={() => void query.refetch()}>
              Thử lại
            </button>
          </div>
        ) : (
          <div className="shift-income__skeleton" aria-hidden="true" />
        )}
      </section>
    )
  }

  const { total, byMethod, count } = summary
  const miniTip = `Doanh thu: ${formatVnd(total)} đ. ${visibleMethods
    .map((key) => `${METHOD_LABEL[key]} ${formatVnd(byMethod[key])}`)
    .join(', ')}`

  return (
    <section className="shift-income" aria-label="Doanh thu">
      <div className="shift-income__total">
        <strong>
          {formatVnd(total)} <small>đ</small>
        </strong>
        <div className="shift-income__filter" ref={settingsRef}>
          <button
            type="button"
            className="shift-income__filter-btn"
            aria-haspopup="true"
            aria-expanded={settingsOpen}
            aria-label="Chọn phương thức thanh toán và nguồn thu tính vào tổng"
            title={settingsOpen ? 'Thu gọn bảng chọn' : 'Chọn phương thức thanh toán và nguồn thu tính vào tổng'}
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <Funnel size={18} weight={settingsOpen ? 'fill' : 'bold'} aria-hidden="true" />
          </button>
          {settingsOpen ? (
            <div className="shift-income__popover" role="group" aria-label="Tính vào tổng thu">
              <p className="shift-income__popover-title">Thanh toán</p>
              {methods.map((key) => {
                const Icon = METHOD_ICON[key]
                const locked = MANDATORY_METHODS.includes(key)
                return (
                  <label
                    key={key}
                    className={`shift-income__check si-m-${key}${locked ? ' is-locked' : ''}`}
                    title={locked ? 'Bắt buộc, luôn tính vào tổng thu.' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={methodSelection[key]}
                      disabled={locked}
                      onChange={() => toggleMethod(key)}
                    />
                    <Icon className="shift-income__icon" size={16} weight="bold" aria-hidden="true" />
                    <span className="shift-income__check-label">{METHOD_LABEL[key]}</span>
                    <span className="shift-income__check-amount">{formatVnd(byMethod[key])}</span>
                  </label>
                )
              })}
              <p className="shift-income__popover-title shift-income__popover-title--next">Nguồn thu</p>
              {income.sources.map((source) => {
                const grouped = source.parts.length > 1
                const selected = sources.find((item) => item.key === source.key)
                return (
                  <div key={source.key} className="shift-income__group">
                    {grouped ? (
                      <div className={`shift-income__group-head si-s-${source.key}`}>
                        <span className="shift-income__row-dot" aria-hidden="true" />
                        <span className="shift-income__check-label">{source.name}</span>
                        <span className="shift-income__check-amount">
                          {formatVnd(selected ? sumSelected(selected, methods, methodSelection) : 0)}
                        </span>
                      </div>
                    ) : null}
                    {source.parts.map((part) => {
                      const locked = MANDATORY_SOURCES.includes(part.key)
                      return (
                        <label
                          key={part.key}
                          className={`shift-income__check shift-income__check--source${
                            grouped ? ' is-child' : ''
                          }${locked ? ' is-locked' : ''}`}
                          title={locked ? 'Bắt buộc, luôn tính vào tổng thu.' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={sourceSelection[part.key]}
                            disabled={locked}
                            onChange={() => toggleSource(part.key)}
                          />
                          <span className="shift-income__check-label">{grouped ? part.name : source.name}</span>
                          <span className="shift-income__check-amount">
                            {formatVnd(sumSelected(part, methods, methodSelection))}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shift-income__meta">
        <span className="shift-income__since" title="24 giờ gần nhất của riêng bạn, cùng khung với ô thống kê COMBO.">
          từ {query.data?.sinceLabel}
        </span>
        <span className="shift-income__count">{count} lượt thu</span>
      </div>

      {/* Biểu đồ tròn tỷ trọng (trái) + một dòng <biểu tượng> <số tiền> cho từng hình thức; tên + số đầy đủ ở tooltip. */}
      <div className="shift-income__summary">
        <MethodPie
          segments={visibleMethods.map((key) => ({
            key,
            share: total > 0 ? byMethod[key] / total : 0,
            title: `${METHOD_LABEL[key]}: ${formatVnd(byMethod[key])} đ`,
          }))}
        />
        <ul className="shift-income__method-line" aria-label="Số tiền theo phương thức thanh toán">
          {visibleMethods.map((key) => (
            <MethodAmount
              key={key}
              method={key}
              amount={byMethod[key]}
              showLabel={visibleMethods.length <= MAX_METHODS_WITH_LABEL}
            />
          ))}
        </ul>
      </div>

      {/* Luôn hiện: thanh tỷ trọng + 3 số của 3 nguồn (thứ tự cố định để màu/vị trí không nhảy khi sắp xếp); nút bung
          chi tiết nằm cạnh thanh. */}
      <div className="shift-income__src-bar">
        <StackedBar
          ariaLabel="Tỷ trọng nguồn thu"
          segments={sources.map((source) => {
            const amount = sumSelected(source, methods, methodSelection)
            return {
              key: source.key,
              className: `si-s-${source.key}`,
              share: total > 0 ? amount / total : 0,
              title: `${source.name}: ${formatVnd(amount)} đ`,
            }
          })}
        />
        <button
          type="button"
          className="shift-income__toggle"
          aria-expanded={open}
          aria-label={open ? 'Thu gọn chi tiết nguồn thu' : 'Xem chi tiết nguồn thu'}
          title={open ? 'Thu gọn chi tiết' : 'Xem chi tiết từng phương thức theo nguồn thu'}
          onClick={toggleOpen}
        >
          <CaretDown className="shift-income__caret" size={12} weight="bold" aria-hidden="true" />
        </button>
      </div>

      <ul className="shift-income__methods">
        {sources.map((source) => (
          <SourceAmount
            key={source.key}
            sourceKey={source.key}
            name={source.name}
            count={source.count}
            amount={sumSelected(source, methods, methodSelection)}
          />
        ))}
      </ul>

      {open ? (
        <div className="shift-income__matrix" style={{ '--si-cols': visibleMethods.length } as CSSProperties}>
          <div className="shift-income__sorts" role="group" aria-label="Sắp xếp theo phương thức thanh toán">
            {visibleMethods.map((key) => {
              const Icon = METHOD_ICON[key]
              const pressed = activeSort === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`shift-income__sort si-m-${key}`}
                  aria-pressed={pressed}
                  aria-label={`Sắp theo ${METHOD_LABEL[key]}`}
                  title={`Sắp theo ${METHOD_LABEL[key]}`}
                  onClick={() => pickSort(key)}
                >
                  <Icon className="shift-income__icon" size={16} weight="bold" aria-hidden="true" />
                  <span className="shift-income__arrow" aria-hidden="true">
                    {pressed ? '▼' : ''}
                  </span>
                </button>
              )
            })}
          </div>
          <ol className="shift-income__rows">
            {visibleSources.map((source) => {
              const expandable = source.parts.length > 1
              const expanded = expandable && expandedSources.includes(source.key)
              return (
                <li key={source.key} className="shift-income__row" title={`${source.name}: ${source.count} lượt`}>
                  <div className="shift-income__row-line">
                    <span className="shift-income__row-name">
                      <span className={`shift-income__row-dot si-s-${source.key}`} aria-hidden="true" />
                      {source.name}
                      {expandable ? (
                        <button
                          type="button"
                          className="shift-income__expand"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Thu gọn' : 'Xem chi tiết'} ${source.name}`}
                          title={expanded ? 'Thu gọn' : 'Xem chi tiết các khoản đã gộp'}
                          onClick={() => toggleExpanded(source.key)}
                        >
                          <CaretRight size={10} weight="bold" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                    <span className="shift-income__row-total">
                      {formatVnd(sumSelected(source, methods, methodSelection))}
                    </span>
                  </div>
                  {renderCells(source)}
                  {expanded ? (
                    <ul className={`shift-income__parts si-s-${source.key}`}>
                      {sortSources(source.parts, activeSort, methods, methodSelection).map((part) => (
                        <li key={part.key} className="shift-income__part" title={`${part.name}: ${part.count} lượt`}>
                          <div className="shift-income__row-line">
                            <span className="shift-income__row-name">{part.name}</span>
                            <span className="shift-income__row-total">
                              {formatVnd(sumSelected(part, methods, methodSelection))}
                            </span>
                          </div>
                          {renderCells(part)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}

      {/* Sidebar thu nhỏ (.app-shell--collapsed): CSS ẩn khối đầy đủ ở trên, chỉ hiện khối này. */}
      <div className="shift-income__mini" title={miniTip} aria-hidden="true">
        <span className="shift-income__mini-title">Doanh thu</span>
        <strong>{formatCompact(total)}</strong>
        {visibleMethods.map((key) => {
          const Icon = METHOD_ICON[key]
          return (
            <span key={key} className={`shift-income__mini-method si-m-${key}`}>
              <Icon className="shift-income__icon" size={12} weight="bold" aria-hidden="true" />
              {formatCompact(byMethod[key])}
            </span>
          )
        })}
      </div>
    </section>
  )
}
