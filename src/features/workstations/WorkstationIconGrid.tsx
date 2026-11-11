import { useMemo, type ReactNode } from 'react'
import { GraduationCap, Money, Ticket } from '@phosphor-icons/react'
import type { WorkstationRuntime } from '../../api/workstations'
import { WorkstationIcon, WorkstationTile } from './WorkstationIcon'
import { getWorkstationIconView, type WorkstationIconContext, type WorkstationIconView } from './workstationModel'
import './workstation-icons.css'

// Chế độ xem "Biểu tượng" (tương đương LVS_ICON của MFC): mỗi máy một ô, tên máy nằm trong màn hình.
// Dùng chung bộ lọc / chọn máy / mở chi tiết với bảng chi tiết; không có tiêu đề cột nên lọc theo nhóm + tình trạng
// làm ở khối thống kê phía trên.

type WorkstationIconGridProps = {
  machines: readonly WorkstationRuntime[]
  selected: ReadonlySet<string>
  onToggle: (hostName: string) => void
  onSelectAll: () => void
  onOpen: (machine: WorkstationRuntime) => void
  getIconContext: (machine: WorkstationRuntime) => WorkstationIconContext
  emptyState?: ReactNode
}

// Chú giải: mỗi mục dùng CHÍNH component WorkstationIcon (không vẽ tay riêng) nên không thể lệch màu với icon thật.
type LegendEntry = { label: string; view: Pick<WorkstationIconView, 'screen' | 'bar' | 'rim'> }
const LEGEND: readonly LegendEntry[] = [
  { label: 'Sẵn sàng', view: { screen: 'available', bar: 'none', rim: 'none' } },
  { label: 'Hội viên', view: { screen: 'inUse', bar: 'member', rim: 'none' } },
  { label: 'Vãng lai trả trước', view: { screen: 'inUse', bar: 'prepaid', rim: 'none' } },
  { label: 'Vãng lai trả sau', view: { screen: 'inUse', bar: 'postpaid', rim: 'none' } },
  { label: 'Admin', view: { screen: 'admin', bar: 'none', rim: 'none' } },
  { label: 'Tắt', view: { screen: 'offline', bar: 'none', rim: 'none' } },
  { label: 'Vừa tắt', view: { screen: 'offline', bar: 'none', rim: 'justOff' } },
  { label: 'Mất kết nối, máy còn bật', view: { screen: 'warning', bar: 'none', rim: 'warning' } },
  { label: 'Client cần nâng cấp', view: { screen: 'minVer', bar: 'none', rim: 'none' } },
  { label: 'Dưới 18 tuổi (kèm icon học sinh)', view: { screen: 'inUse', bar: 'member', rim: 'minor' } },
]

export function WorkstationIconGrid({
  machines,
  selected,
  onToggle,
  onSelectAll,
  onOpen,
  getIconContext,
  emptyState,
}: WorkstationIconGridProps) {
  const entries = useMemo(
    () => machines.map((machine) => ({ machine, view: getWorkstationIconView(machine, getIconContext(machine)) })),
    [machines, getIconContext],
  )
  const allSelected = machines.length > 0 && machines.every((machine) => selected.has(machine.hostName))

  if (machines.length === 0) return <>{emptyState}</>

  return (
    <div className="ws-icon-view">
      <div className="ws-icon-view__bar">
        <label className="ws-icon-view__select-all">
          <input type="checkbox" checked={allSelected} onChange={onSelectAll} />
          Chọn tất cả ({machines.length} máy)
        </label>
        <div className="ws-icon-view__legend" aria-label="Chú giải icon">
          {LEGEND.map((entry) => (
            <span key={entry.label} className="ws-icon-view__legend-item">
              <WorkstationIcon
                view={{ ...entry.view, debt: false, minor: false, reservation: null, description: entry.label }}
                size={22}
              />
              {entry.label}
            </span>
          ))}
          <span className="ws-icon-view__legend-item ws-machine-cell__flag--minor">
            <GraduationCap size={16} weight="fill" aria-hidden="true" />
            <span>Dưới 18 tuổi</span>
          </span>
          <span className="ws-icon-view__legend-item ws-machine-cell__flag--money">
            <Money size={16} weight="fill" aria-hidden="true" />
            <span>Còn nợ</span>
          </span>
          <span className="ws-icon-view__legend-item ws-machine-cell__flag--reserved">
            <Ticket size={16} weight="fill" aria-hidden="true" />
            <span>Có đặt chỗ</span>
          </span>
          <span className="ws-icon-view__legend-item ws-machine-cell__flag--late">
            <Ticket size={16} weight="fill" aria-hidden="true" />
            <span>Khách đặt chỗ đến trễ</span>
          </span>
        </div>
      </div>
      <div className="ws-icon-view__grid" role="list">
        {entries.map(({ machine, view }) => (
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
    </div>
  )
}
