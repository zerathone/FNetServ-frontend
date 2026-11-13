import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  ArrowsLeftRight,
  CalendarCheck,
  CurrencyCircleDollar,
  GraduationCap,
  Lock,
  Money,
  Pause,
  Receipt,
  Warning,
} from '@phosphor-icons/react'
import type { WorkstationRuntime } from '../../api/workstations'
import { CallBellIcon } from './CallBellIcon'
import type { IconActivity, WorkstationIconView } from './workstationModel'
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

// Chip hoạt động phụ (gọi món, chờ thu tiền…): cùng bộ icon + màu tone với cột Trạng thái của bảng Chi tiết.
const ACTIVITY_ICON: Record<IconActivity, { render: () => ReactNode; className: string }> = {
  lock: { render: () => <Lock size={14} weight="fill" aria-hidden="true" />, className: 'ws-tile__chip--lock' },
  order: { render: () => <CallBellIcon size={14} />, className: 'ws-tile__chip--order' },
  accept: { render: () => <CurrencyCircleDollar size={14} weight="fill" aria-hidden="true" />, className: 'ws-tile__chip--accept' },
  transfer: { render: () => <Receipt size={14} weight="fill" aria-hidden="true" />, className: 'ws-tile__chip--transfer' },
  pause: { render: () => <Pause size={14} weight="fill" aria-hidden="true" />, className: 'ws-tile__chip--pause' },
  changing: { render: () => <ArrowsLeftRight size={14} weight="bold" aria-hidden="true" />, className: 'ws-tile__chip--changing' },
}
const MAX_VISIBLE_CHIPS = 3

/** Một chip đứng riêng (không nằm trên ô máy) — dùng cho chú giải biểu tượng. */
export function ActivityChipIcon({ activity }: { activity: IconActivity }) {
  return (
    <span className="ws-tile__chips ws-tile__chips--static" aria-hidden="true">
      <span className={`ws-tile__chip ${ACTIVITY_ICON[activity].className}`}>{ACTIVITY_ICON[activity].render()}</span>
    </span>
  )
}

/** Hàng chip nhỏ ở mép dưới ô máy. Nhiều hơn MAX_VISIBLE_CHIPS thì các mục cuối gộp thành chip `+N` (tên đầy đủ nằm ở tooltip của ô). */
function ActivityChips({ activities }: { activities: IconActivity[] }) {
  if (activities.length === 0) return null
  const overflow = activities.length > MAX_VISIBLE_CHIPS
  const shown = overflow ? activities.slice(0, MAX_VISIBLE_CHIPS - 1) : activities
  const hidden = overflow ? activities.slice(MAX_VISIBLE_CHIPS - 1) : []
  return (
    <span className="ws-tile__chips" aria-hidden="true">
      {shown.map((activity) => (
        <span key={activity} className={`ws-tile__chip ${ACTIVITY_ICON[activity].className}`}>
          {ACTIVITY_ICON[activity].render()}
        </span>
      ))}
      {hidden.length > 0 ? (
        <span className="ws-tile__chip ws-tile__chip--more">+{hidden.length}</span>
      ) : null}
    </span>
  )
}

const NAME_MAX_LINES = 2
const ELLIPSIS = '…'

/**
 * Tên máy trong thân màn hình: xuống dòng tối đa 2 dòng; vẫn không đủ chỗ thì cắt PHẦN ĐẦU và thay bằng "…"
 * (đuôi tên — thường là số thứ tự máy — luôn hiện đủ). CSS không cắt đầu được khi nhiều dòng nên đo bằng một span ẩn
 * cùng kiểu chữ + cùng bề rộng, tìm đuôi dài nhất còn vừa 2 dòng (tìm nhị phân). Đo lại khi ô đổi cỡ (zoom).
 * Tên đầy đủ luôn nằm ở tooltip.
 */
export function TileName({ text }: { text: string }) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState(text)

  useLayoutEffect(() => {
    const measure = measureRef.current
    const box = measure?.parentElement
    if (!measure || !box) return

    const lineHeightPx = () => {
      const style = getComputedStyle(measure)
      const lh = parseFloat(style.lineHeight)
      return Number.isFinite(lh) ? lh : parseFloat(style.fontSize) * 1.1
    }
    // Chưa có chữ để đo (ẩn / bề rộng 0) ⇒ giữ nguyên, CSS line-clamp vẫn chặn tràn.
    const fits = (candidate: string) => {
      measure.textContent = candidate
      return measure.scrollHeight <= lineHeightPx() * NAME_MAX_LINES + 1
    }
    const compute = () => {
      if (measure.clientWidth === 0) return
      if (fits(text)) {
        setShown(text)
        return
      }
      // Đuôi dài nhất (k ký tự cuối) mà "…" + đuôi còn vừa; k = 1 luôn là mức tối thiểu.
      let lo = 1
      let hi = Math.max(1, text.length - 1)
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(ELLIPSIS + text.slice(-mid))) lo = mid
        else hi = mid - 1
      }
      setShown(ELLIPSIS + text.slice(-lo).trimStart())
    }

    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  return (
    <span className="ws-tile__name">
      <span className="ws-tile__name-text" title={text}>
        {shown}
      </span>
      <span ref={measureRef} className="ws-tile__name-measure" aria-hidden="true" />
    </span>
  )
}

/** Một ô máy ở chế độ xem Biểu tượng. memo: snapshot đổi mỗi 30 giây nhưng chỉ vài máy đổi trạng thái. */
export const WorkstationTile = memo(function WorkstationTile({ machine, view, selected, onOpen, onToggle }: WorkstationTileProps) {
  // Huy hiệu GÓC TRÊN PHẢI xếp từ mép phải sang trái theo ưu tiên: còn nợ > đặt chỗ > dưới 18 tuổi.
  // Dưới 18 tuổi ưu tiên THẤP NHẤT: có huy hiệu khác thì nhường chỗ đầu (vẫn hiện, lùi sang ô kế; viền vàng + tooltip luôn báo).
  const topRight: Array<{ kind: 'money' | 'reserved' | 'late' | 'minor'; icon: ReactNode }> = []
  if (view.debt) topRight.push({ kind: 'money', icon: <Money {...CORNER_ICON} /> })
  if (view.reservation) topRight.push({ kind: view.reservation, icon: <CalendarCheck {...CORNER_ICON} /> })
  if (view.minor) topRight.push({ kind: 'minor', icon: <GraduationCap {...CORNER_ICON} /> })

  return (
    <div className={`ws-tile ws-tile--screen-${view.screen}${selected ? ' ws-tile--selected' : ''}`} data-host={machine.hostName}>
      <button
        type="button"
        className="ws-tile__btn"
        title={`${machine.hostName} — ${view.description}`}
        aria-label={`${machine.hostName}: ${view.description}`}
        onClick={() => onOpen(machine)}
      >
        <WorkstationIcon view={view} glyph={false} />
        <TileName text={machine.hostName} />
      </button>
      <input
        type="checkbox"
        className="ws-tile__check"
        data-host-check={machine.hostName}
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
      {topRight.map((badge, index) => (
        <span
          key={badge.kind}
          className={`ws-tile__corner ws-tile__corner--r${index + 1} ws-tile__corner--${badge.kind}`}
          aria-hidden="true"
        >
          {badge.icon}
        </span>
      ))}
      <ActivityChips activities={view.activities} />
    </div>
  )
})
