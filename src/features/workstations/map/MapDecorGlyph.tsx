import {
  ArrowFatDown,
  Cigarette,
  Couch,
  FireExtinguisher,
  GameController,
  Martini,
  NumberCircleEight,
  PingPong,
  SoccerBall,
  SteeringWheel,
  Toilet,
  VirtualReality,
  type Icon,
} from '@phosphor-icons/react'
import type { MapDecorType } from '../../../api/workstationMapTypes.ts'
import { isWallPiece, wallPieceArms, type WallPieceType } from './mapModel.ts'

// Icon của đồ vật / dấu mốc trên sơ đồ — dùng icon Phosphor CÓ SẴN (không thêm thư viện, không vẽ tay).
// Tường (thẳng, chữ L, chữ T) là các thanh CSS (không phải icon) nên không nằm trong bảng này.
// NGOẠI LỆ: quầy thu ngân (`reception`) là SVG vẽ riêng (ReceptionGlyph) — Phosphor không có hình "người đứng sau quầy",
// mà quầy thu ngân là mốc quan trọng nhất của sơ đồ nên phải nhận ra ngay (user chốt hình mẫu: màn hình + người + quầy có nan).
type IconDecorType = Exclude<MapDecorType, 'wall_h' | 'wall_v' | 'reception' | WallPieceType>

const DECOR_ICONS: Record<IconDecorType, Icon> = {
  entrance: ArrowFatDown,
  bar: Martini,
  wc: Toilet,
  billiard: NumberCircleEight,
  table_football: SoccerBall,
  ping_pong: PingPong,
  hookah: Cigarette,
  vr: VirtualReality,
  racing: SteeringWheel,
  console: GameController,
  sofa: Couch,
  fire_extinguisher: FireExtinguisher,
}

/**
 * Quầy thu ngân: màn hình (có chấm) đặt trên mặt quầy, người đứng sau quầy, thân quầy có nan dọc.
 * Một màu `currentColor` (đồ vật không có trạng thái); chấm màn hình + khe nan là LỖ khoét (evenodd) nên ăn theo màu nền.
 * Lưới 256 như icon Phosphor để cùng cỡ với các icon khác khi đặt cạnh nhau.
 */
function ReceptionGlyph() {
  return (
    <svg className="wsmap-decor wsmap-decor--reception" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <rect x="16" y="148" width="224" height="24" rx="12" />
      <path
        fillRule="evenodd"
        d="M44 172h168v56a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4Z M66 192h5v32h-5Z M90 192h5v32h-5Z M114 192h5v32h-5Z M138 192h5v32h-5Z M162 192h5v32h-5Z M186 192h5v32h-5Z"
      />
      <circle cx="156" cy="64" r="24" />
      <path d="M108 148C108 114 128 100 156 100s48 14 48 48Z" />
      <path
        fillRule="evenodd"
        d="M44 64h60a8 8 0 0 1 8 8v36a8 8 0 0 1-8 8H44a8 8 0 0 1-8-8V72a8 8 0 0 1 8-8Z M74 90a8 8 0 1 0 0 16a8 8 0 1 0 0-16Z"
      />
      <rect x="66" y="116" width="16" height="32" />
    </svg>
  )
}

/** Hình của một đồ vật. Kích thước theo ô (CSS `--wsmap-cell`), không truyền px. */
export function MapDecorGlyph({ type }: { type: MapDecorType }) {
  if (type === 'reception') return <ReceptionGlyph />
  if (type === 'wall_h') return <span className="wsmap-wall wsmap-wall--h" aria-hidden="true" />
  if (type === 'wall_v') return <span className="wsmap-wall wsmap-wall--v" aria-hidden="true" />
  if (isWallPiece(type)) {
    return (
      <span className="wsmap-wallpiece" aria-hidden="true">
        {wallPieceArms(type).map((arm) => (
          <i key={arm} className={`wsmap-wallpiece__arm wsmap-wallpiece__arm--${arm}`} />
        ))}
      </span>
    )
  }
  const IconComponent = DECOR_ICONS[type]
  return <IconComponent className="wsmap-decor" weight="fill" aria-hidden="true" />
}
