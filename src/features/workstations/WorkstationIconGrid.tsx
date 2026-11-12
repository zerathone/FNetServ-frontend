import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { CaretDown, CaretLeft, CaretRight, GraduationCap, Money, Ticket } from '@phosphor-icons/react'
import type { WorkstationRuntime } from '../../api/workstations'
import { Button } from '../../design-system/components'
import { MapZoomSlider } from './map/MapZoomSlider'
import { VIEW_ZOOM_DEFAULT_INDEX, VIEW_ZOOM_LEVELS, VIEW_ZOOM_STORAGE_KEY } from './map/mapZoom.ts'
import { useMapZoom } from './map/useMapZoom'
import { useDragSelect } from './useDragSelect'
import { ActivityChipIcon, WorkstationIcon, WorkstationTile } from './WorkstationIcon'
import {
  ICON_ACTIVITY_LABEL,
  getWorkstationIconView,
  groupMachines,
  type IconActivity,
  type WorkstationIconContext,
  type WorkstationIconView,
} from './workstationModel'
import './workstation-icons.css'

// Chế độ xem "Biểu tượng" (tương đương LVS_ICON của MFC): mỗi máy một ô, tên máy nằm trong màn hình.
// Dùng chung bộ lọc / chọn máy / mở chi tiết với bảng chi tiết; không có tiêu đề cột nên lọc theo nhóm + tình trạng
// làm ở khối thống kê phía trên.

type WorkstationIconGridProps = {
  machines: readonly WorkstationRuntime[]
  /** Danh sách nhóm máy (đúng thứ tự quán đặt) dùng để gom + đặt tên nhóm. */
  groups: readonly { id: number; name: string }[]
  selected: ReadonlySet<string>
  onToggle: (hostName: string) => void
  /** Kéo-chọn / Shift+click: nhận cả tập mới (xem useDragSelect). */
  onChangeSelection: (next: Set<string>) => void
  onSelectAll: () => void
  onOpen: (machine: WorkstationRuntime) => void
  getIconContext: (machine: WorkstationRuntime) => WorkstationIconContext
  emptyState?: ReactNode
}

// Chú giải: mỗi mục dùng CHÍNH component WorkstationIcon (không vẽ tay riêng) nên không thể lệch màu với icon thật.
// Thứ tự = thứ tự hiển thị; chế độ thu gọn chỉ hiện LEGEND_COLLAPSED_COUNT mục đầu.
type LegendEntry = { label: string; render: () => ReactNode; className?: string }
const stateEntry = (label: string, view: Pick<WorkstationIconView, 'screen' | 'bar' | 'rim'>): LegendEntry => ({
  label,
  render: () => (
    <WorkstationIcon view={{ ...view, debt: false, minor: false, reservation: null, activities: [], description: label }} size={22} />
  ),
})
const activityEntry = (activity: IconActivity): LegendEntry => ({
  label: ICON_ACTIVITY_LABEL[activity],
  render: () => <ActivityChipIcon activity={activity} />,
})
const flagEntry = (label: string, className: string, Icon: typeof Ticket): LegendEntry => ({
  label,
  className,
  render: () => <Icon size={20} weight="fill" aria-hidden="true" />,
})
const LEGEND: readonly LegendEntry[] = [
  stateEntry('Sẵn sàng', { screen: 'available', bar: 'none', rim: 'none' }),
  stateEntry('Hội viên', { screen: 'inUse', bar: 'member', rim: 'none' }),
  stateEntry('Vãng lai trả trước / thẻ combo', { screen: 'inUse', bar: 'prepaid', rim: 'none' }),
  stateEntry('Vãng lai trả sau', { screen: 'inUse', bar: 'postpaid', rim: 'none' }),
  stateEntry('Admin', { screen: 'admin', bar: 'none', rim: 'none' }),
  stateEntry('Tắt', { screen: 'offline', bar: 'none', rim: 'none' }),
  stateEntry('Vừa tắt', { screen: 'offline', bar: 'none', rim: 'justOff' }),
  stateEntry('Mất kết nối, máy còn bật', { screen: 'warning', bar: 'none', rim: 'warning' }),
  stateEntry('Client cần nâng cấp', { screen: 'minVer', bar: 'none', rim: 'none' }),
  stateEntry('Dưới 18 tuổi (kèm icon học sinh)', { screen: 'inUse', bar: 'member', rim: 'minor' }),
  flagEntry('Dưới 18 tuổi', 'ws-machine-cell__flag--minor', GraduationCap),
  flagEntry('Còn nợ', 'ws-machine-cell__flag--money', Money),
  flagEntry('Có đặt chỗ', 'ws-machine-cell__flag--reserved', Ticket),
  flagEntry('Khách đặt chỗ đến trễ', 'ws-machine-cell__flag--late', Ticket),
  // Hoạt động phụ: cùng nhãn / icon / màu với cột Trạng thái của bảng Chi tiết.
  activityEntry('lock'),
  activityEntry('order'),
  activityEntry('accept'),
  activityEntry('transfer'),
  activityEntry('pause'),
  activityEntry('changing'),
]
const LEGEND_COLLAPSED_COUNT = 4
/**
 * Ô "chọn tất cả máy của nhóm" đứng trước nút nhóm: tick = chọn hết máy nhóm, bỏ tick = bỏ hết; chọn một phần = trạng thái lưng chừng.
 * Chỉ đụng máy của nhóm này (máy nhóm khác / máy đang bị lọc giữ nguyên). Không có `data-host-check` nên không dính kéo-chọn.
 */
function GroupCheckAll({
  name,
  hosts,
  selected,
  onChange,
}: {
  name: string
  hosts: readonly string[]
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const count = hosts.filter((host) => selected.has(host)).length
  const full = hosts.length > 0 && count === hosts.length
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !full
  }, [count, full])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="ws-icon-group__all"
      checked={full}
      aria-label={`Chọn tất cả máy nhóm ${name}`}
      title="Chọn / bỏ chọn tất cả máy trong nhóm"
      onChange={(event) => {
        const next = new Set(selected)
        for (const host of hosts) {
          if (event.target.checked) next.add(host)
          else next.delete(host)
        }
        onChange(next)
      }}
    />
  )
}

const ZOOM_LABELS = VIEW_ZOOM_LEVELS.map((level) => `${Math.round(level * 100)}%`)

export function WorkstationIconGrid({
  machines,
  groups,
  selected,
  onToggle,
  onChangeSelection,
  onSelectAll,
  onOpen,
  getIconContext,
  emptyState,
}: WorkstationIconGridProps) {
  const dragSelect = useDragSelect({ selected, onChange: onChangeSelection })
  // Cùng mức zoom với sơ đồ (một lựa chọn "cỡ biểu tượng" cho cả hai kiểu xem của thu ngân).
  const [zoomIndex, setZoomIndex] = useMapZoom(VIEW_ZOOM_STORAGE_KEY, VIEW_ZOOM_LEVELS.length, VIEW_ZOOM_DEFAULT_INDEX)
  const zoom = VIEW_ZOOM_LEVELS[zoomIndex]
  // Nhóm đang thu gọn (theo id nhóm). Chỉ nhớ trong phiên xem; mặc định mở hết.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const sections = useMemo(
    () =>
      groupMachines(machines, groups).map((section) => ({
        ...section,
        entries: section.machines.map((machine) => ({
          machine,
          view: getWorkstationIconView(machine, getIconContext(machine)),
        })),
      })),
    [machines, groups, getIconContext],
  )
  const allSelected = machines.length > 0 && machines.every((machine) => selected.has(machine.hostName))

  if (machines.length === 0) return <>{emptyState}</>

  const toggleGroup = (groupId: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(groupId)) next.add(groupId)
      return next
    })

  return (
    <div className="ws-icon-view" onPointerDown={dragSelect.onPointerDown}>
      <IconViewBar
        total={machines.length}
        allSelected={allSelected}
        onSelectAll={onSelectAll}
        trailing={<MapZoomSlider value={zoomIndex} labels={ZOOM_LABELS} onChange={setZoomIndex} ariaLabel="Phóng to / thu nhỏ biểu tượng" />}
      />
      {sections.map((section) => {
        const open = !collapsed.has(section.groupId)
        const gridId = `ws-icon-group-${section.groupId}`
        return (
          <section key={section.groupId} className="ws-icon-group" aria-label={`Nhóm máy ${section.name}`}>
            <div className="ws-icon-group__head">
              <GroupCheckAll
                name={section.name}
                hosts={section.machines.map((machine) => machine.hostName)}
                selected={selected}
                onChange={onChangeSelection}
              />
              <Button
                type="button"
                variant="ghost"
                className="ws-icon-group__toggle"
                icon={open ? <CaretDown size={14} weight="bold" aria-hidden="true" /> : <CaretRight size={14} weight="bold" aria-hidden="true" />}
                aria-expanded={open}
                aria-controls={gridId}
                onClick={() => toggleGroup(section.groupId)}
              >
                {section.name} <span className="ws-icon-group__count">({section.machines.length})</span>
              </Button>
            </div>
            {open ? (
              <div
                id={gridId}
                className="ws-icon-view__grid ws-icon-view__grid--scaled"
                role="list"
                style={{ '--wsmap-zoom': zoom } as CSSProperties}
              >
                {section.entries.map(({ machine, view }) => (
                  <div key={machine.hostName} role="listitem">
                    <WorkstationTile
                      machine={machine}
                      view={view}
                      selected={selected.has(machine.hostName)}
                      onOpen={onOpen}
                      onToggle={onToggle}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/** Thanh trên cùng của chế độ Biểu tượng: ô "Chọn tất cả" + chú giải icon (một hàng, thu gọn được). Dùng chung cho lưới phẳng và sơ đồ. */
export function IconViewBar({
  total,
  allSelected,
  onSelectAll,
  afterSelectAll,
  trailing,
}: {
  total: number
  allSelected: boolean
  onSelectAll: () => void
  /** Phần tử đặt ngay sau ô "Chọn tất cả" (vd nút bật/tắt máy chưa xếp vị trí của sơ đồ). */
  afterSelectAll?: ReactNode
  /** Phần tử đặt ở đầu bên phải của thanh (vd nút zoom của sơ đồ). */
  trailing?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const hiddenCount = LEGEND.length - LEGEND_COLLAPSED_COUNT
  const shown = expanded ? LEGEND : LEGEND.slice(0, LEGEND_COLLAPSED_COUNT)
  return (
    <div className={`ws-icon-view__bar${expanded ? ' ws-icon-view__bar--expanded' : ''}`}>
      <label className="ws-icon-view__select-all">
        <input type="checkbox" checked={allSelected} onChange={onSelectAll} />
        Chọn tất cả ({total} máy)
      </label>
      {afterSelectAll}
      <div className="ws-icon-view__legend" aria-label="Chú giải icon">
        <div className="ws-icon-view__legend-items" id="ws-icon-legend-items">
          {shown.map((entry) => (
            <span key={entry.label} className={`ws-icon-view__legend-item${entry.className ? ` ${entry.className}` : ''}`}>
              {entry.render()}
              <span>{entry.label}</span>
            </span>
          ))}
        </div>
        <Button
          type="button"
          variant="neutral"
          className="ws-icon-view__legend-toggle"
          icon={expanded ? <CaretLeft size={14} weight="bold" aria-hidden="true" /> : <CaretRight size={14} weight="bold" aria-hidden="true" />}
          aria-expanded={expanded}
          aria-controls="ws-icon-legend-items"
          aria-label={expanded ? 'Thu gọn chú thích biểu tượng' : `Xem thêm ${hiddenCount} chú thích biểu tượng`}
          title={expanded ? 'Thu gọn' : 'Xem thêm'}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? null : `+${hiddenCount}`}
        </Button>
      </div>
      {trailing}
    </div>
  )
}