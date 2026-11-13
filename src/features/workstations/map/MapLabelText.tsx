import type { CSSProperties } from 'react'
import type { MapLabelItem } from '../../../api/workstationMapTypes.ts'
import {
  DEFAULT_LABEL_TEXT,
  LABEL_FONT_CSS,
  LABEL_SIZE_BASE_CELL_PX,
  normalizeLabelFont,
  normalizeLabelSize,
} from './mapModel.ts'

// Nhãn chữ trên sơ đồ (task ws-map-label). Neo giữa ô, chữ một dòng được TRÀN ra hai bên (không chiếm thêm ô).
// Cỡ chữ co giãn theo ô (`--wsmap-cell`) nên giữ đúng tỉ lệ khi zoom và ở màn thu ngân.

export function MapLabelText({ item }: { item: MapLabelItem }) {
  const empty = item.text.trim() === ''
  const style: CSSProperties = {
    color: item.color,
    fontFamily: LABEL_FONT_CSS[normalizeLabelFont(item.font)],
    fontSize: `calc(var(--wsmap-cell) * ${normalizeLabelSize(item.size) / LABEL_SIZE_BASE_CELL_PX})`,
  }
  return (
    <span className={`wsmap-label${empty ? ' wsmap-label--empty' : ''}`} style={style}>
      {empty ? DEFAULT_LABEL_TEXT : item.text}
    </span>
  )
}
