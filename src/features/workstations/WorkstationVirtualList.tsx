import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
  type WorkstationFilter,
} from './workstationModel'

const STATUS_FILTER_OPTIONS: FilterMenuOption<WorkstationFilter>[] = [
  { value: 'connected', label: 'Đang kết nối', color: 'var(--color-action-primary)' },
  { value: 'playing', label: 'Đang chơi', color: 'var(--color-info)' },
  { value: 'available', label: 'Sẵn sàng', color: 'var(--color-success)' },
  { value: 'debt', label: 'Còn nợ', color: 'var(--color-warning)' },
  { value: 'disconnected', label: 'Mất kết nối', color: 'var(--color-danger)' },
  { value: 'all', label: 'Tất cả' },
]

const DEFAULT_ROW_HEIGHT = 68
const CLASSIC_ROW_HEIGHT = 48
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
  { id: 'machine', label: 'Tên máy', width: 'minmax(8.5rem, 1.15fr)', required: true },
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
}: WorkstationVirtualListProps) {
  const { theme } = useTheme()
  const rowHeight = theme === 'classic' ? CLASSIC_ROW_HEIGHT : DEFAULT_ROW_HEIGHT
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
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

  useEffect(() => {
    const maximumScroll = Math.max(0, machines.length * rowHeight - viewportHeight)
    if (scrollTop > maximumScroll) {
      setScrollTop(maximumScroll)
      viewportRef.current?.scrollTo({ top: maximumScroll })
    }
  }, [machines.length, rowHeight, scrollTop, viewportHeight])

  const gridStyle = {
    '--ws-table-columns': `2.5rem ${visibleColumns.map((column) => column.width).join(' ')}`,
  } as CSSProperties
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2
  const end = Math.min(machines.length, start + visibleCount)
  const visibleMachines = machines.slice(start, end)
  const allSelected = machines.length > 0 && machines.every((item) => selected.has(item.hostName))

  const renderCell = (column: ColumnDefinition, machine: WorkstationRuntime) => {
    const clock = interpolateSession(machine, elapsedSeconds)
    if (column.id === 'machine') return <button type="button" className="ws-table__machine" role="cell" onClick={() => onOpen(machine)}><strong>{machine.hostName}</strong></button>
    if (column.id === 'ip') return <div className="ws-table__truncate" role="cell">{machine.ip || '—'}</div>
    if (column.id === 'status') {
      const status = getWorkstationStatus(machine)
      const flags = getWorkstationFlags(machine)
      return <div className="ws-table__status" role="cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{flags.slice(0, 1).map((flag) => <StatusBadge key={flag.label} tone={flag.tone}>{flag.label}</StatusBadge>)}{flags.length > 1 ? <span className="ws-table__more-flags">+{flags.length - 1}</span> : null}</div>
    }
    if (column.id === 'user') return <div className="ws-table__user" role="cell"><strong>{machine.userName || '—'}</strong></div>
    if (column.id === 'combo') return <div className="ws-table__truncate" role="cell">{machine.session?.comboName || '—'}</div>
    if (column.id === 'startedAt') return <div className="ws-table__number" role="cell">{formatStartedAt(machine.session?.startedAt)}</div>
    if (column.id === 'used') return <div className="ws-table__number" role="cell">{formatDuration(clock.used)}</div>
    if (column.id === 'remaining') return <div className="ws-table__number" role="cell">{formatDuration(clock.remaining)}</div>
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
      const title = [lic.label, lic.channel, lic.pkey ? `Key ...${lic.pkey}` : '', lic.graceText]
        .filter(Boolean)
        .join(' · ')
      return (
        <div className="ws-table__status" role="cell" title={title}>
          <StatusBadge tone={lic.tone}>{lic.label}</StatusBadge>
          {lic.pkey ? <span className="ws-table__more-flags">{lic.pkey}</span> : null}
        </div>
      )
    }
    return <div className="ws-table__truncate" role="cell" title={machine.note || undefined}>{machine.note || '—'}</div>
  }

  return (
    <div className="ws-table" role="table" aria-rowcount={machines.length + 1}>
      <div className="ws-table__header ws-table__grid" role="row" style={gridStyle}>
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
          return <div key={column.id} role="columnheader">{column.label}</div>
        })}
      </div>
      <div ref={viewportRef} className="ws-table__viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="ws-table__canvas" style={{ height: `${machines.length * rowHeight}px` }}>
          {visibleMachines.map((machine, index) => {
            const selectedRow = selected.has(machine.hostName)
            return <div key={machine.hostName} className={`ws-table__row ws-table__grid${selectedRow ? ' ws-table__row--selected' : ''}`} role="row" aria-rowindex={start + index + 2} style={{ ...gridStyle, height: `${rowHeight}px`, transform: `translateY(${(start + index) * rowHeight}px)` }} onDoubleClick={() => onOpen(machine)}>
              <div role="cell"><input type="checkbox" aria-label={`Chọn ${machine.hostName}`} checked={selectedRow} onChange={() => onToggle(machine.hostName)} /></div>
              {visibleColumns.map((column) => <div key={column.id} className="ws-table__cell-wrap">{renderCell(column, machine)}</div>)}
            </div>
          })}
        </div>
      </div>
    </div>
  )
}
