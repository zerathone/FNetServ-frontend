import {
  ArrowFatDown,
  Cigarette,
  Couch,
  FireExtinguisher,
  GameController,
  Headset,
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

// Icon của đồ vật / dấu mốc trên sơ đồ — dùng icon Phosphor CÓ SẴN (không thêm thư viện, không vẽ tay).
// Tường là hai thanh CSS (không phải icon) nên không nằm trong bảng này.
type IconDecorType = Exclude<MapDecorType, 'wall_h' | 'wall_v'>

const DECOR_ICONS: Record<IconDecorType, Icon> = {
  entrance: ArrowFatDown,
  reception: Headset,
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

/** Hình của một đồ vật. Kích thước theo ô (CSS `--wsmap-cell`), không truyền px. */
export function MapDecorGlyph({ type }: { type: MapDecorType }) {
  if (type === 'wall_h') return <span className="wsmap-wall wsmap-wall--h" aria-hidden="true" />
  if (type === 'wall_v') return <span className="wsmap-wall wsmap-wall--v" aria-hidden="true" />
  const IconComponent = DECOR_ICONS[type]
  return <IconComponent className="wsmap-decor" weight="fill" aria-hidden="true" />
}
