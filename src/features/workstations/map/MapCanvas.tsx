import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import type { MapItem, MapLayout, MapPcItem } from '../../../api/workstationMapTypes.ts'
import { MapDecorGlyph } from './MapDecorGlyph'
import { readDragPayload, writeDragPayload, type MapDragPayload } from './mapDrag.ts'
import { DECOR_LABEL, cellKey, isPc } from './mapModel.ts'
import './map.css'

// Khung vẽ lưới sơ đồ, DÙNG CHUNG cho trình chỉnh sửa (mode 'edit': mọi ô là một đích bấm / thả) và màn hình thu ngân
// (mode 'view': chỉ vẽ ô có phần tử, không có tương tác). Phần "máy" do nơi dùng quyết định qua `renderPc`.

type MapCanvasProps = {
  layout: MapLayout
  /** Cỡ ô (CSS length, vd '3.5rem'). */
  cell: string
  /** Chiều cao ô nếu khác chiều rộng (màn hình thu ngân chừa chỗ cho huy hiệu phía trên ô máy). */
  cellHeight?: string
  mode: 'edit' | 'view'
  selected?: { c: number; r: number } | null
  renderPc: (item: MapPcItem) => ReactNode
  onCellPointerDown?: (c: number, r: number) => void
  onCellPointerEnter?: (c: number, r: number) => void
  onCellDrop?: (c: number, r: number, payload: MapDragPayload) => void
  onRemove?: (c: number, r: number) => void
}

export function MapCanvas({
  layout,
  cell,
  cellHeight,
  mode,
  selected,
  renderPc,
  onCellPointerDown,
  onCellPointerEnter,
  onCellDrop,
  onRemove,
}: MapCanvasProps) {
  const items = useMemo(() => new Map(layout.items.map((item) => [cellKey(item.c, item.r), item])), [layout.items])

  const style = {
    '--wsmap-cell': cell,
    '--wsmap-cell-h': cellHeight ?? cell,
    gridTemplateColumns: `repeat(${layout.cols}, var(--wsmap-cell))`,
    gridTemplateRows: `repeat(${layout.rows}, var(--wsmap-cell-h))`,
  } as CSSProperties

  const renderContent = (item: MapItem) => (isPc(item) ? renderPc(item) : <MapDecorGlyph type={item.t} />)
  const labelOf = (item: MapItem) => (isPc(item) ? item.host : DECOR_LABEL[item.t])

  if (mode === 'view') {
    return (
      <div className="wsmap wsmap--view" style={style}>
        {layout.items.map((item) => (
          <div
            key={cellKey(item.c, item.r)}
            className={`wsmap__cell${isPc(item) ? ' wsmap__cell--pc' : ''}`}
            style={{ gridColumn: item.c + 1, gridRow: item.r + 1 }}
            title={isPc(item) ? undefined : labelOf(item)}
          >
            {renderContent(item)}
          </div>
        ))}
      </div>
    )
  }

  const cells: ReactNode[] = []
  for (let r = 0; r < layout.rows; r += 1) {
    for (let c = 0; c < layout.cols; c += 1) {
      const item = items.get(cellKey(c, r))
      const isSelected = Boolean(selected && selected.c === c && selected.r === r && item)
      cells.push(
        <div
          key={cellKey(c, r)}
          className={`wsmap__cell${isSelected ? ' is-selected' : ''}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onCellPointerDown?.(c, r)
          }}
          onPointerEnter={() => onCellPointerEnter?.(c, r)}
          onDragOver={(event) => {
            if (onCellDrop) event.preventDefault()
          }}
          onDrop={(event) => {
            const payload = readDragPayload(event)
            if (!payload || !onCellDrop) return
            event.preventDefault()
            onCellDrop(c, r, payload)
          }}
        >
          {item ? (
            <div
              className="wsmap__item"
              draggable
              title={labelOf(item)}
              onDragStart={(event) => writeDragPayload(event, { kind: 'move', c, r })}
            >
              {renderContent(item)}
            </div>
          ) : null}
          {isSelected && onRemove ? (
            <button
              type="button"
              className="wsmap__remove"
              aria-label={`Xóa ${item ? labelOf(item) : 'phần tử'} khỏi sơ đồ`}
              title="Xóa khỏi sơ đồ"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onRemove(c, r)}
            >
              <X size={12} weight="bold" aria-hidden="true" />
            </button>
          ) : null}
        </div>,
      )
    }
  }

  return (
    <div className="wsmap wsmap--edit" style={style}>
      {cells}
    </div>
  )
}
