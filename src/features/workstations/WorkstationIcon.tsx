import { memo } from 'react'
import { ArrowUp, GraduationCap, Money, Ticket, Warning } from '@phosphor-icons/react'
import type { WorkstationRuntime } from '../../api/workstations'
import type { WorkstationIconView } from './workstationModel'
import './workstation-icons.css'

// Icon máy trạm kiểu web (task ws-status-icons). Hình + màu: workstation-icons.css; cây quyết định: getWorkstationIconView.

type WorkstationIconProps = {
  view: WorkstationIconView
  /** Chiều rộng (px). Chiều cao tự theo tỉ lệ 64:56. Bỏ trống ⇒ co theo CSS cha (dùng trong ô lưới). */
  size?: number
  /** Vẽ glyph (mũi tên nâng cấp / tam giác cảnh báo) vào thân màn hình — tắt ở ô lưới vì tên máy nằm đè lên đó. */
  glyph?: boolean
  className?: string
}

export function WorkstationIcon({ view, size, glyph = true, className }: WorkstationIconProps) {
  const classes = [
    'ws-ic',
    `ws-ic--screen-${view.screen}`,
    `ws-ic--bar-${view.bar}`,
    `ws-ic--rim-${view.rim}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <svg
      className={classes}
      width={size}
      height={size ? (size * 56) / 64 : undefined}
      viewBox="0 0 64 56"
      role="img"
      aria-label={view.description}
    >
      <rect className="ws-ic__stand" x="22" y="46" width="20" height="5" rx="2.5" />
      <rect className="ws-ic__screen" x="2" y="2" width="60" height="40" rx="7" />
      <path className="ws-ic__bar" d="M2 33h60v2a7 7 0 0 1-7 7H9a7 7 0 0 1-7-7z" />
      {glyph && view.screen === 'minVer' ? <path className="ws-ic__glyph" d="M32 7l11 12h-6.5v8h-9v-8H21z" /> : null}
      {glyph && view.screen === 'warning' ? (
        <>
          <path className="ws-ic__glyph" d="M32 7l12 21H20z" />
          <rect x="31" y="14" width="2" height="7" fill="var(--ws-ic-offline)" />
          <circle cx="32" cy="24" r="1.4" fill="var(--ws-ic-offline)" />
        </>
      ) : null}
      {view.rim !== 'none' ? <rect className="ws-ic__rim" x="1" y="1" width="62" height="42" rx="7.5" /> : null}
    </svg>
  )
}

type WorkstationTileProps = {
  machine: WorkstationRuntime
  view: WorkstationIconView
  selected: boolean
  onOpen: (machine: WorkstationRuntime) => void
  onToggle: (hostName: string) => void
}

const CORNER_ICON = { size: 20, weight: 'fill' as const, 'aria-hidden': true }

/** Một ô máy ở chế độ xem Biểu tượng. memo: snapshot đổi mỗi 30 giây nhưng chỉ vài máy đổi trạng thái. */
export const WorkstationTile = memo(function WorkstationTile({ machine, view, selected, onOpen, onToggle }: WorkstationTileProps) {
  return (
    <div className={`ws-tile ws-tile--screen-${view.screen}${selected ? ' ws-tile--selected' : ''}`}>
      <button
        type="button"
        className="ws-tile__btn"
        title={`${machine.hostName} — ${view.description}`}
        aria-label={`${machine.hostName}: ${view.description}`}
        onClick={() => onOpen(machine)}
      >
        <WorkstationIcon view={view} glyph={false} />
        <span className="ws-tile__name">
          <span>{machine.hostName}</span>
        </span>
      </button>
      <input
        type="checkbox"
        className="ws-tile__check"
        checked={selected}
        aria-label={`Chọn ${machine.hostName}`}
        onChange={() => onToggle(machine.hostName)}
      />
      {view.screen === 'warning' ? (
        <span className="ws-tile__corner ws-tile__corner--l ws-tile__corner--warning" aria-hidden="true">
          <Warning {...CORNER_ICON} />
        </span>
      ) : null}
      {view.screen === 'minVer' ? (
        <span className="ws-tile__corner ws-tile__corner--l ws-tile__corner--minVer" aria-hidden="true">
          <ArrowUp {...CORNER_ICON} weight="bold" />
        </span>
      ) : null}
      {view.minor ? (
        <span className="ws-tile__corner ws-tile__corner--br ws-tile__corner--minor" aria-hidden="true">
          <GraduationCap {...CORNER_ICON} />
        </span>
      ) : null}
      {view.debt ? (
        <span className="ws-tile__corner ws-tile__corner--r1 ws-tile__corner--money" aria-hidden="true">
          <Money {...CORNER_ICON} />
        </span>
      ) : null}
      {view.reservation ? (
        <span
          className={`ws-tile__corner ${view.debt ? 'ws-tile__corner--r2' : 'ws-tile__corner--r1'} ws-tile__corner--${view.reservation}`}
          aria-hidden="true"
        >
          <Ticket {...CORNER_ICON} />
        </span>
      ) : null}
    </div>
  )
})

/** Icon nhỏ cạnh tên máy ở bảng chi tiết: học sinh (dưới 18), tiền đỏ (còn nợ), vé (đặt chỗ). Trả null khi không có gì. */
export function MachineCellFlags({ view }: { view: WorkstationIconView }) {
  if (!view.debt && !view.minor && !view.reservation) return null
  return (
    <>
      {view.minor ? (
        <span className="ws-machine-cell__flag ws-machine-cell__flag--minor" role="img" aria-label="Dưới 18 tuổi" title="Dưới 18 tuổi">
          <GraduationCap size={20} weight="fill" aria-hidden="true" />
        </span>
      ) : null}
      {view.debt ? (
        <span className="ws-machine-cell__flag ws-machine-cell__flag--money" role="img" aria-label="Còn nợ" title="Còn nợ">
          <Money size={20} weight="fill" aria-hidden="true" />
        </span>
      ) : null}
      {view.reservation ? (
        <span
          className={`ws-machine-cell__flag ws-machine-cell__flag--${view.reservation}`}
          role="img"
          aria-label={view.reservation === 'late' ? 'Khách đặt chỗ đến trễ' : 'Có đặt chỗ'}
          title={view.reservation === 'late' ? 'Khách đặt chỗ đến trễ' : 'Có đặt chỗ'}
        >
          <Ticket size={20} weight="fill" aria-hidden="true" />
        </span>
      ) : null}
    </>
  )
}
