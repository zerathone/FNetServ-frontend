import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowsLeftRight, CaretLeft, CaretRight, CurrencyCircleDollar, GraduationCap, Pause, Receipt, Warning } from '@phosphor-icons/react'
import { CallBellIcon } from './CallBellIcon'
import type { MachineGroup } from '../../api/machine-groups'
import type { WorkstationRuntime } from '../../api/workstations'
import { FilterHeaderCell, StatusBadge, type FilterMenuOption } from '../../design-system/components'
import { useTheme } from '../../design-system/theme/themeContext'
import {
  formatDuration,
  formatMoney,
  formatStartedAt,
  getWinLicenseView,
  getWorkstationFlags,
  getWorkstationStatus,
  interpolateSession,
  type FlagIconKey,
  type WorkstationFilter,
} from './workstationModel'

type IconComponent = React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>
const FLAG_ICONS: Record<FlagIconKey, IconComponent> = {
  graduationCap: GraduationCap,
  warning: Warning,
  pause: Pause,
  arrowsLeftRight: ArrowsLeftRight,
  receipt: Receipt,
}

const STATUS_FILTER_OPTIONS: FilterMenuOption<WorkstationFilter>[] = [
  { value: 'connected', label: 'Đang kết nối', color: 'var(--color-action-primary)' },
  { value: 'playing', label: 'Đang sử dụng', color: 'var(--color-info)' },
  { value: 'available', label: 'Sẵn sàng', color: 'var(--color-success)' },
  { value: 'debt', label: 'Còn nợ', color: 'var(--color-warning)' },
  { value: 'disconnected', label: 'Mất kết nối', color: 'var(--color-danger)' },
  { value: 'all', label: 'Tất cả' },
]

// Dòng thường chỉ 1 badge ⇒ thấp nhất có thể (badge 24px + 5px mỗi phía). Chỉ khi ô Tình trạng có hàng thứ 2
// (cờ dịch vụ/nợ/tạm dừng… xếp dưới badge) mới dùng chiều cao STACKED (24 + 4 gap + 24 + lề).
const ROW_HEIGHTS = {
  default: { compact: 34, stacked: 60 },
  classic: { compact: 30, stacked: 56 },
} as const
const OVERSCAN = 6
export const COLUMN_STORAGE_KEY = 'fnet.workstations.visible-columns.v1'

export type ColumnId =
  | 'machine'
  | 'ip'
  | 'status'
  | 'user'
  | 'combo'
  | 'startedAt'
  | 'used'
  | 'remaining'
  | 'amount'
  | 'date'
  | 'version'
  | 'group'
  | 'note'
  | 'winLicense'

export type ColumnDefinition = {
  id: ColumnId
  label: string
  width: string
  required?: boolean
  defaultVisible?: boolean
}

export const COLUMNS: ColumnDefinition[] = [
  { id: 'machine', label: 'Tên máy', width: 'minmax(6rem, 0.6fr)', required: true },
  { id: 'ip', label: 'Địa chỉ IP', width: '8.5rem' },
  { id: 'status', label: 'Tình trạng', width: 'minmax(9.5rem, 1.2fr)', required: true },
  { id: 'user', label: 'Người dùng', width: 'minmax(8rem, 1fr)', required: true },
  { id: 'combo', label: 'COMBO', width: 'minmax(8rem, 1fr)', defaultVisible: true },
  { id: 'startedAt', label: 'Bắt đầu', width: '6.5rem', defaultVisible: true },
  { id: 'used', label: 'Đã dùng', width: '6.5rem', defaultVisible: true },
  { id: 'remaining', label: 'Còn lại', width: '6.5rem', defaultVisible: true },
  { id: 'amount', label: 'Số tiền', width: '7.5rem', defaultVisible: true },
  { id: 'date', label: 'Ngày', width: '7rem' },
  { id: 'version', label: 'Phiên bản', width: '7rem' },
  { id: 'group', label: 'Nhóm máy', width: 'minmax(7rem, 1fr)', defaultVisible: true },
  { id: 'note', label: 'Ghi chú', width: 'minmax(9rem, 1.1fr)' },
  // Khong dat defaultVisible => AN MAC DINH, khop voi ban MFC (width 0 trong CSetting)
  { id: 'winLicense', label: 'Windows', width: 'minmax(9rem, 1fr)' },
]

const OPTIONAL_IDS = new Set(COLUMNS.filter((column) => !column.required).map((column) => column.id))

export function getInitialOptionalColumns() {
  const defaults = COLUMNS.filter((column) => !column.required && column.defaultVisible).map((column) => column.id)
  try {
    const stored = window.localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!stored) return new Set<ColumnId>(defaults)
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set<ColumnId>(defaults)
    return new Set(parsed.filter((id): id is ColumnId => typeof id === 'string' && OPTIONAL_IDS.has(id as ColumnId)))
  } catch {
    return new Set<ColumnId>(defaults)
  }
}

function datePart(value: string | null | undefined) {
  if (!value) return '—'
  return value.split(' ')[0] || '—'
}

type WorkstationVirtualListProps = {
  machines: WorkstationRuntime[]
  elapsedSeconds: number
  selected: Set<string>
  onToggle: (hostName: string) => void
  onSelectAll: () => void
  onOpen: (machine: WorkstationRuntime) => void
  groups: MachineGroup[]
  groupId: number
  onGroupChange: (groupId: number) => void
  filter: WorkstationFilter
  onFilterChange: (filter: WorkstationFilter) => void
  visibleColumns: ColumnDefinition[]
  /** Máy đã thu hết nợ dịch vụ ⇒ bỏ badge "Đã nhận món" (cờ server còn sót). */
  isServiceAcceptCleared?: (machine: WorkstationRuntime) => boolean
  /**
   * Bấm nút icon cờ dịch vụ: 'orders' = Có gọi món (xem đơn của máy), 'collect' = Đã nhận món (thu tiền).
   * Không truyền ⇒ hai cờ này vẫn hiện dạng badge như cũ.
   */
  onOpenOrders?: (machine: WorkstationRuntime, target: 'orders' | 'collect') => void
  emptyState?: ReactNode
}

export function WorkstationVirtualList({
  machines,
  elapsedSeconds,
  selected,
  onToggle,
  onSelectAll,
  onOpen,
  groups,
  groupId,
  onGroupChange,
  filter,
  onFilterChange,
  visibleColumns,
  isServiceAcceptCleared,
  onOpenOrders,
  emptyState,
}: WorkstationVirtualListProps) {
  const { theme } = useTheme()
  const heights = theme === 'classic' ? ROW_HEIGHTS.classic : ROW_HEIGHTS.default
  const showStatusColumn = visibleColumns.some((column) => column.id === 'status')
  // tops[i] = vị trí đỉnh dòng i; tops[n] = tổng chiều cao. Dòng cao/thấp tuỳ có hàng cờ thứ 2 hay không.
  const { tops, totalHeight } = useMemo(() => {
    const offsets = new Array<number>(machines.length + 1)
    let sum = 0
    for (let index = 0; index < machines.length; index += 1) {
      offsets[index] = sum
      const machine = machines[index]
      const stacked = showStatusColumn && getWorkstationFlags(machine, { hideServiceAccept: isServiceAcceptCleared?.(machine) }).length > 0
      sum += stacked ? heights.stacked : heights.compact
    }
    offsets[machines.length] = sum
    return { tops: offsets, totalHeight: sum }
  }, [machines, showStatusColumn, isServiceAcceptCleared, heights])
  const viewportRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })
  const groupOptions: FilterMenuOption<number>[] = [
    { value: 0, label: 'Tất cả nhóm' },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ]

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateHeight = () => setViewportHeight(viewport.clientHeight)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  // Nút nổi cuộn ngang ở tiêu đề: chỉ hiện khi còn nội dung bị che ở phía đó (khỏi phải kéo thanh cuộn dưới đáy).
  const updateScrollEdges = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      setScrollEdges((current) => (current.left || current.right ? { left: false, right: false } : current))
      return
    }
    const left = viewport.scrollLeft > 1
    const right = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1
    setScrollEdges((current) => (current.left === left && current.right === right ? current : { left, right }))
  }

  useEffect(() => {
    updateScrollEdges()
    const viewport = viewportRef.current
    if (!viewport) return
    // Đổi cỡ khung hoặc bật/tắt cột làm thay đổi chiều rộng nội dung ⇒ tính lại.
    const observer = new ResizeObserver(updateScrollEdges)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines.length, visibleColumns.length])

  const scrollHorizontally = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollBy({ left: direction * Math.max(160, viewport.clientWidth * 0.7), behavior: 'smooth' })
  }

  useEffect(() => {
    // Danh sách rỗng -> vùng thân bị gỡ (scrollLeft về 0 mà không có sự kiện cuộn) nên trả tiêu đề về đầu.
    if (machines.length === 0 && headerRef.current) headerRef.current.style.transform = ''
  }, [machines.length])

  useEffect(() => {
    const maximumScroll = Math.max(0, totalHeight - viewportHeight)
    if (scrollTop > maximumScroll) {
      setScrollTop(maximumScroll)
      viewportRef.current?.scrollTo({ top: maximumScroll })
    }
  }, [totalHeight, scrollTop, viewportHeight])

  const gridStyle = {
    '--ws-table-columns': `2rem ${visibleColumns.map((column) => column.width).join(' ')}`,
  } as CSSProperties
  // Tìm nhị phân dòng đầu tiên còn nằm (một phần) trong khung nhìn, rồi lấy thêm OVERSCAN dòng mỗi phía.
  const findRowAt = (offset: number) => {
    let low = 0
    let high = machines.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (tops[mid] <= offset) low = mid
      else high = mid - 1
    }
    return low
  }
  const start = machines.length === 0 ? 0 : Math.max(0, findRowAt(scrollTop) - OVERSCAN)
  const end = machines.length === 0 ? 0 : Math.min(machines.length, findRowAt(scrollTop + viewportHeight) + 1 + OVERSCAN)
  const visibleMachines = machines.slice(start, end)
  const allSelected = machines.length > 0 && machines.every((item) => selected.has(item.hostName))

  const renderCell = (column: ColumnDefinition, machine: WorkstationRuntime) => {
    const clock = interpolateSession(machine, elapsedSeconds)
    if (column.id === 'machine') return <button type="button" className="ws-table__machine" role="cell" onClick={() => onOpen(machine)}><strong>{machine.hostName}</strong></button>
    if (column.id === 'ip') return <div className="ws-table__truncate" role="cell">{machine.ip || '—'}</div>
    if (column.id === 'status') {
      const status = getWorkstationStatus(machine)
      const flags = getWorkstationFlags(machine, { hideServiceAccept: isServiceAcceptCleared?.(machine) })
      // Hai cờ dịch vụ là NÚT: bấm sang trang Đơn dịch vụ (lọc sẵn theo máy), xếp ở hàng thứ 2 dưới badge tình trạng.
      // Từ 2 mục trở lên trong hàng cờ ⇒ toàn bộ chuyển icon-only (tooltip nói rõ nội dung).
      const serviceFlags = onOpenOrders ? flags.filter((flag) => flag.id) : []
      const iconOnly = flags.length >= 2
      return (
        <div className="ws-table__status" role="cell">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {flags.length > 0 ? (
            <div className="ws-flag-row">
              {flags
                .filter((flag) => !serviceFlags.includes(flag))
                .map((flag) => {
                  if (iconOnly && flag.iconKey) {
                    const Icon = FLAG_ICONS[flag.iconKey]
                    return (
                      <span
                        key={flag.label}
                        className={`ws-flag-btn ws-flag-btn--icon ws-flag-btn--${flag.tone}`}
                        title={flag.label}
                        role="img"
                        aria-label={flag.label}
                      >
                        <Icon size={14} aria-hidden="true" />
                      </span>
                    )
                  }
                  return <StatusBadge key={flag.label} tone={flag.tone}>{flag.label}</StatusBadge>
                })}
              {serviceFlags.map((flag) => {
                const collect = flag.id === 'service_accept'
                return (
                  <button
                    key={flag.label}
                    type="button"
                    className={`ws-flag-btn ws-flag-btn--${collect ? 'success' : flag.tone}${iconOnly ? ' ws-flag-btn--icon' : ''}`}
                    title={collect ? 'Đã nhận món, chờ thu tiền — mở Đơn dịch vụ của máy này' : 'Có gọi món — mở Đơn dịch vụ của máy này'}
                    aria-label={`${collect ? 'Thu tiền' : 'Gọi món'}: mở Đơn dịch vụ của ${machine.hostName}`}
                    onClick={() => onOpenOrders?.(machine, collect ? 'collect' : 'orders')}
                  >
                    {collect ? <CurrencyCircleDollar size={16} weight="bold" aria-hidden="true" /> : <CallBellIcon size={16} />}
                    {iconOnly ? null : <span>{collect ? 'Thu tiền' : 'Gọi món'}</span>}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      )
    }
    if (column.id === 'user') return <div className="ws-table__user" role="cell"><strong>{machine.userName || '—'}</strong></div>
    if (column.id === 'combo') return <div className="ws-table__truncate" role="cell">{machine.session?.comboName || '—'}</div>
    if (column.id === 'startedAt') return <div className="ws-table__number" role="cell">{formatStartedAt(machine.session?.startedAt, 'minutes')}</div>
    if (column.id === 'used') return <div className="ws-table__number" role="cell">{formatDuration(clock.used, 'minutes')}</div>
    if (column.id === 'remaining') return <div className="ws-table__number" role="cell">{formatDuration(clock.remaining, 'minutes')}</div>
    if (column.id === 'amount') return <div className="ws-table__money" role="cell">{formatMoney(machine.session?.totalAmount)}</div>
    if (column.id === 'date') return <div className="ws-table__number" role="cell">{datePart(machine.session?.startedAt)}</div>
    if (column.id === 'version') return <div className="ws-table__truncate" role="cell">{machine.version || '—'}</div>
    if (column.id === 'group') return <div className="ws-table__group" role="cell">{machine.machineGroupName || `Nhóm ${machine.machineGroupId}`}</div>
    if (column.id === 'winLicense') {
      const lic = getWinLicenseView(machine)
      // Chua co du lieu => O TRONG co y (khong dung '—' nhu cac cot khac): may co the
      // dang chay client cu, tat co `hwm`, hoac Server.exe vua restart. Hien bat ky
      // nhan nao o day cung de bi doc thanh "may chua kich hoat Windows".
      if (!lic) return <div className="ws-table__truncate" role="cell" />
      // Co key => mau (tone) da the hien trang thai, badge hien key thay vi lap lai nhan "Da kich hoat".
      const badgeText = lic.pkey || lic.label
      const title = [lic.label, lic.channel, lic.pkey ? `Key ...${lic.pkey}` : '', lic.graceText]
        .filter(Boolean)
        .join(' · ')
      return (
        <div className="ws-table__status" role="cell" title={title}>
          <StatusBadge tone={lic.tone}>{badgeText}</StatusBadge>
        </div>
      )
    }
    return <div className="ws-table__truncate" role="cell" title={machine.note || undefined}>{machine.note || '—'}</div>
  }

  return (
    <div className="ws-table" role="table" aria-rowcount={machines.length + 1}>
      <div ref={headerRef} className="ws-table__header ws-table__grid" role="row" style={gridStyle}>
        <div role="columnheader"><input type="checkbox" aria-label={allSelected ? 'Bỏ chọn tất cả máy đang hiển thị' : 'Chọn tất cả máy đang hiển thị'} checked={allSelected} onChange={onSelectAll} /></div>
        {visibleColumns.map((column) => {
          if (column.id === 'group') {
            return (
              <FilterHeaderCell
                key={column.id}
                label={column.label}
                options={groupOptions}
                value={groupId}
                baseline={0}
                onChange={onGroupChange}
                menuLabel="Lọc theo nhóm máy"
                clearLabel="Bỏ lọc nhóm máy"
              />
            )
          }
          if (column.id === 'status') {
            return (
              <FilterHeaderCell
                key={column.id}
                label={column.label}
                options={STATUS_FILTER_OPTIONS}
                value={filter}
                baseline="all"
                onChange={onFilterChange}
                menuLabel="Lọc theo phạm vi"
                clearLabel="Bỏ lọc phạm vi"
              />
            )
          }
          return (
            <div
              key={column.id}
              role="columnheader"
              className={column.id === 'amount' ? 'ws-table__col-money' : undefined}
            >
              {column.label}
            </div>
          )
        })}
      </div>
      {scrollEdges.left ? (
        <button
          type="button"
          className="ws-table__scroll-btn ws-table__scroll-btn--left"
          aria-label="Cuộn bảng sang trái"
          title="Cuộn sang trái"
          onClick={() => scrollHorizontally(-1)}
        >
          <CaretLeft size={16} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {scrollEdges.right ? (
        <button
          type="button"
          className="ws-table__scroll-btn ws-table__scroll-btn--right"
          aria-label="Cuộn bảng sang phải"
          title="Cuộn sang phải"
          onClick={() => scrollHorizontally(1)}
        >
          <CaretRight size={16} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {machines.length === 0 ? (
        <div className="ws-table__empty">{emptyState}</div>
      ) : (
        <div
          ref={viewportRef}
          className="ws-table__viewport"
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop)
            // Thanh cuộn ngang chỉ có ở vùng thân; tiêu đề trượt theo để cột luôn thẳng hàng.
            if (headerRef.current) headerRef.current.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`
            updateScrollEdges()
          }}
        >
          <div className="ws-table__canvas" style={{ height: `${totalHeight}px` }}>
            {visibleMachines.map((machine, index) => {
              const selectedRow = selected.has(machine.hostName)
              const rowIndex = start + index
              return <div key={machine.hostName} className={`ws-table__row ws-table__grid${selectedRow ? ' ws-table__row--selected' : ''}`} role="row" aria-rowindex={rowIndex + 2} style={{ ...gridStyle, height: `${tops[rowIndex + 1] - tops[rowIndex]}px`, transform: `translateY(${tops[rowIndex]}px)` }} onDoubleClick={() => onOpen(machine)}>
                <div role="cell"><input type="checkbox" aria-label={`Chọn ${machine.hostName}`} checked={selectedRow} onChange={() => onToggle(machine.hostName)} /></div>
                {visibleColumns.map((column) => <div key={column.id} className="ws-table__cell-wrap">{renderCell(column, machine)}</div>)}
              </div>
            })}
          </div>
        </div>
      )}
    </div>
  )
}
