import { useEffect, useRef, useState } from 'react'
import { Check, CaretDown, CaretLeft, CaretRight, Desktop, SquaresFour, UsersThree } from '@phosphor-icons/react'
import type { WorkstationFilter } from './workstationModel'
import './workstation-summary-compact.css'

// Bản THU GỌN của khối thống kê trang Máy trạm (bản đầy đủ nằm trong WorkstationWorkspace: 3 thẻ). Cùng dữ liệu
// và cùng bộ lọc, chỉ khác cách bày: 1 thanh cao ~2,75rem, 3 cụm ngăn bằng vạch dọc --
//   [Máy trạm 14 ● Sử dụng 11 ● Sẵn sàng 2 ● Mất kết nối 1 (biểu đồ tròn)]  |  [Sử dụng ● Hội viên 6 ● Vãng lai 3 ● Combo 2]
//   |  [Khu vực 0%  ‹ Standard 0/1  FPS 0/1 ... › (cuộn ngang, có nút 2 bên khi thiếu chỗ)]  [mở rộng]
// Cụm Khu vực nuốt phần còn lại của hàng.

export type SummaryFleetSegment = { key: string; label: string; value: number; filter?: WorkstationFilter }
export type SummaryZone = { id: number; name: string; inUse: number; total: number; percent: number }
export type SummaryCounts = {
  playing: number
  available: number
  disconnected: number
  member: number
  anonym: number
  combo: number
  admin: number
}

type Props = {
  total: number
  counts: SummaryCounts
  fleetSegments: SummaryFleetSegment[]
  fleetTotal: number
  filter: WorkstationFilter
  onFilterChange: (filter: WorkstationFilter) => void
  zones: SummaryZone[]
  overallUsagePercent: number
  zoneId: number
  /** Bấm lại đúng khu vực đang lọc = bỏ lọc (cùng hành vi với bản đầy đủ) -> caller tự xử lý toggle. */
  onZoneToggle: (zoneId: number) => void
  onExpand: () => void
}

/** Cờ "còn nội dung bị che" ở 2 đầu dải cuộn ngang -> phủ mờ mép đó cho người dùng biết còn nữa. */
function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  return { ref, edges }
}

// Biểu đồ tròn đặc: mỗi mảnh = 1 vòng tròn bán kính 8, nét dày 16 (phủ kín tâm), pathLength=100 để độ dài nét = %.
// Giữa các mảnh chừa khe PIE_GAP (đơn vị %). Luôn vẽ khi có máy (chốt 2026-11-03): chỉ 1 trạng thái dương thì là hình tròn
// đặc, không chừa khe (khe duy nhất sẽ trông như vòng bị hở).
const PIE_RADIUS = 8
const PIE_GAP = 3

function FleetPie({ segments, total }: { segments: SummaryFleetSegment[]; total: number }) {
  const visible = segments.filter((segment) => segment.value > 0)
  if (visible.length === 0 || total <= 0) return null
  // Toàn bộ máy đang được sử dụng (chỉ còn 1 mảnh 'playing' = 100%): thay hình tròn đặc bằng dấu tick success cho gọn mắt.
  if (visible.length === 1 && visible[0].key === 'playing') {
    return (
      <span
        className="ws-sumc__done"
        role="img"
        aria-label={`Tất cả ${total} máy trạm đang được sử dụng`}
        title={`Sử dụng: ${total}/${total}`}
      >
        <Check size={12} weight="bold" aria-hidden="true" />
      </span>
    )
  }
  const gap = visible.length > 1 ? PIE_GAP : 0
  let start = 0
  return (
    <svg
      className="ws-sumc__pie"
      viewBox="0 0 36 36"
      role="img"
      aria-label={`Tình trạng ${total} máy trạm của phòng máy: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
    >
      <g transform="rotate(-90 18 18)">
        {visible.map((segment) => {
          const share = (segment.value / total) * 100
          const length = Math.max(share - gap, 1)
          const offset = start + gap / 2
          start += share
          return (
            <circle
              key={segment.key}
              className={`ws-sumc__slice ws-sumc__slice--${segment.key}`}
              cx="18"
              cy="18"
              r={PIE_RADIUS}
              pathLength={100}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-offset}
            >
              <title>{`${segment.label}: ${segment.value}/${total}`}</title>
            </circle>
          )
        })}
      </g>
    </svg>
  )
}

export function WorkstationSummaryCompact({
  total,
  counts,
  fleetSegments,
  fleetTotal,
  filter,
  onFilterChange,
  zones,
  overallUsagePercent,
  zoneId,
  onZoneToggle,
  onExpand,
}: Props) {
  const { ref: zonesRef, edges } = useScrollEdges()
  const scrollZones = (direction: 1 | -1) => {
    const el = zonesRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 96), behavior: 'smooth' })
  }
  // Thu gọn thì chỉ hiện mục có số > 0 (bản đầy đủ vẫn hiện hết). Ngoại lệ: chip trạng thái ĐANG LỌC luôn hiện dù về 0,
  // nếu không người dùng không còn thấy mình đang lọc gì (muốn bỏ lọc thì bấm "Máy trạm").
  const statusChips: Array<{ key: WorkstationFilter; dot: string; label: string; value: number }> = [
    { key: 'playing' as const, dot: 'playing', label: 'Sử dụng', value: counts.playing },
    { key: 'available' as const, dot: 'available', label: 'Sẵn sàng', value: counts.available },
    { key: 'disconnected' as const, dot: 'disconnected', label: 'Mất kết nối', value: counts.disconnected },
  ].filter((chip) => chip.value > 0 || filter === chip.key)
  const kindChips = [
    { dot: 'member', label: 'Hội viên', value: counts.member },
    { dot: 'anonym', label: 'Vãng lai', value: counts.anonym },
    { dot: 'combo', label: 'Combo', value: counts.combo },
    { dot: 'admin', label: 'Admin', value: counts.admin },
  ].filter((chip) => chip.value > 0)
  const fadeClass = `${edges.left ? ' is-fade-left' : ''}${edges.right ? ' is-fade-right' : ''}`

  return (
    <div className="ws-sumc" aria-label="Tổng quan máy trạm (thu gọn)">
      <button
        type="button"
        className="ws-sumc__toggle"
        aria-label="Mở rộng thống kê"
        title="Mở rộng thống kê"
        aria-expanded={false}
        onClick={onExpand}
      >
        <CaretDown size={16} weight="bold" aria-hidden="true" />
      </button>

      <div className="ws-sumc__group">
        <button
          type="button"
          className={`ws-sumc__title ws-sumc__title--button${filter === 'all' ? ' is-active' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          <Desktop size={16} weight="bold" aria-hidden="true" />
          Máy trạm
          <strong>{total}</strong>
        </button>
        {statusChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`ws-sumc__chip${filter === chip.key ? ' is-active' : ''}`}
            onClick={() => onFilterChange(chip.key)}
          >
            <span className={`ws-summary__dot ws-summary__dot--${chip.dot}`} aria-hidden="true" />
            {chip.label}
            <strong>{chip.value}</strong>
          </button>
        ))}
        {fleetTotal > 0 ? <FleetPie segments={fleetSegments} total={fleetTotal} /> : null}
      </div>

      {kindChips.length > 0 ? (
        <div className="ws-sumc__group">
          <span className="ws-sumc__title">
            <UsersThree size={16} weight="bold" aria-hidden="true" />
            Sử dụng
          </span>
          {kindChips.map((chip) => (
            <span key={chip.dot} className="ws-sumc__chip ws-sumc__chip--static">
              <span className={`ws-summary__dot ws-summary__dot--${chip.dot}`} aria-hidden="true" />
              {chip.label}
              <strong>{chip.value}</strong>
            </span>
          ))}
        </div>
      ) : null}

      {zones.length > 0 ? (
        <div className="ws-sumc__group ws-sumc__group--zones">
          <span className="ws-sumc__title">
            <SquaresFour size={16} weight="bold" aria-hidden="true" />
            Khu vực
            <strong>{overallUsagePercent}%</strong>
          </span>
          <div className="ws-sumc__zones-wrap">
            {edges.left ? (
              <button
                type="button"
                className="ws-sumc__scroll ws-sumc__scroll--left"
                aria-label="Cuộn sang trái"
                onClick={() => scrollZones(-1)}
              >
                <CaretLeft size={14} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
            <div className={`ws-sumc__zones${fadeClass}`} ref={zonesRef}>
              {zones.map((zone) => {
                // Khu vực đã kín máy: thanh chuyển màu success + dấu tick thay cho số %.
                const isFull = zone.total > 0 && zone.inUse >= zone.total
                return (
                  <button
                    key={zone.id}
                    type="button"
                    className={`ws-sumc__zone${zoneId === zone.id ? ' is-active' : ''}${isFull ? ' is-full' : ''}`}
                    aria-pressed={zoneId === zone.id}
                    aria-label={`${zone.name}: ${zone.inUse}/${zone.total} máy đang dùng (${zone.percent}%)${isFull ? ', đã kín máy' : ''}`}
                    title={`${zone.name}: ${zone.inUse}/${zone.total} (${zone.percent}%)`}
                    onClick={() => onZoneToggle(zone.id)}
                  >
                    <span className="ws-sumc__zone-head">
                      <span className="ws-sumc__zone-name">{zone.name}</span>
                      <strong>
                        {zone.inUse}/{zone.total}
                      </strong>
                    </span>
                    <span className="ws-sumc__zone-foot" aria-hidden="true">
                      <span className="ws-sumc__zone-bar">
                        <span className="ws-sumc__zone-fill" style={{ width: `${zone.percent}%` }} />
                      </span>
                      {isFull ? (
                        <span className="ws-sumc__zone-done">
                          <Check size={8} weight="bold" />
                        </span>
                      ) : (
                        <span className="ws-sumc__zone-pct">{zone.percent}%</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            {edges.right ? (
              <button
                type="button"
                className="ws-sumc__scroll ws-sumc__scroll--right"
                aria-label="Cuộn sang phải"
                onClick={() => scrollZones(1)}
              >
                <CaretRight size={14} weight="bold" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
