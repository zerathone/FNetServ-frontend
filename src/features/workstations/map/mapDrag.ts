import type { DragEvent } from 'react'
import type { MapDecorType } from '../../../api/workstationMapTypes.ts'

// Dữ liệu kéo-thả (HTML5 DnD) của sơ đồ: dời một phần tử có sẵn, hoặc thả từ bảng phần tử xuống ô.
// Tách khỏi MapCanvas.tsx để file đó chỉ export component (fast refresh).

export type MapDragPayload =
  | { kind: 'move'; c: number; r: number }
  | { kind: 'pc'; host: string }
  | { kind: 'decor'; type: MapDecorType }

const DRAG_MIME = 'application/x-fnet-wsmap'

export function writeDragPayload(event: DragEvent, payload: MapDragPayload) {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'move'
}

export function readDragPayload(event: DragEvent): MapDragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_MIME)
    if (!raw) return null
    const data = JSON.parse(raw) as MapDragPayload
    if (data.kind === 'move' && Number.isInteger(data.c) && Number.isInteger(data.r)) return data
    if (data.kind === 'pc' && typeof data.host === 'string') return data
    if (data.kind === 'decor' && typeof data.type === 'string') return data
    return null
  } catch {
    return null
  }
}