import { useMemo, useState } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Button } from '../../../design-system/components'
import type { MapLayout } from '../../../api/workstationMapTypes.ts'
import type { WorkstationRuntime } from '../../../api/workstations'
import { useDragSelect } from '../useDragSelect'
import { WorkstationTile } from '../WorkstationIcon'
import { IconViewBar } from '../WorkstationIconGrid'
import { getWorkstationIconView, type WorkstationIconContext } from '../workstationModel'
import { MapCanvas } from './MapCanvas'
import { MapZoomSlider } from './MapZoomSlider'
import { VIEW_ZOOM_DEFAULT_INDEX, VIEW_ZOOM_LEVELS, VIEW_ZOOM_STORAGE_KEY } from './mapZoom.ts'
import { useMapZoom } from './useMapZoom'
import { hostKey, placedHosts } from './mapModel.ts'
import './map.css'

// Chế độ Biểu tượng của thu ngân khi quán ĐÃ vẽ sơ đồ (Cài đặt → Sơ đồ máy trạm): máy nằm đúng ô, dùng cùng icon trạng thái
// và huy hiệu như lưới phẳng; tường / đồ vật chỉ là mốc mờ. Máy chưa có trên sơ đồ xếp ở dải dưới nên không bao giờ bị ẩn.
// Bộ lọc (nhóm / tình trạng / từ khóa) KHÔNG dời máy: máy không khớp chỉ mờ đi, vị trí giữ nguyên.
// Máy chưa xếp nằm sau nút bật/tắt "Chưa xếp vị trí (N)" đặt kế ô "Chọn tất cả" (mặc định thu gọn; 0 máy thì không có nút); khi bung nằm ở hàng TRÊN sơ đồ, vẽ ở 75% cỡ.

type WorkstationMapViewProps = {
  layout: MapLayout
  /** TOÀN BỘ máy của quán (chưa lọc). */
  machines: readonly WorkstationRuntime[]
  /** Máy khớp bộ lọc hiện tại; không có trong đây ⇒ mờ. */
  visibleHosts: ReadonlySet<string>
  selected: ReadonlySet<string>
  /** Kéo-chọn / Shift+click: nhận cả tập mới (xem useDragSelect). */
  onChangeSelection: (next: Set<string>) => void
  allVisibleSelected: boolean
  visibleCount: number
  onToggle: (hostName: string) => void
  onSelectAll: () => void
  onOpen: (machine: WorkstationRuntime) => void
  getIconContext: (machine: WorkstationRuntime) => WorkstationIconContext
}

// Ô lớn hơn hình máy (5,75rem): chừa chỗ cho huy hiệu nhô ra hai bên / treo phía trên để huy hiệu máy kề nhau không chạm nhau.
// Kích thước ở mức zoom 1× (mức giữa của thanh trượt); các mức khác nhân hệ số này.
const CELL_WIDTH_REM = 7.5
const CELL_HEIGHT_REM = 7.75
const ZOOM_LABELS = VIEW_ZOOM_LEVELS.map((level) => `${Math.round(level * 100)}%`)

export function WorkstationMapView({
  layout,
  machines,
  visibleHosts,
  selected,
  onChangeSelection,
  allVisibleSelected,
  visibleCount,
  onToggle,
  onSelectAll,
  onOpen,
  getIconContext,
}: WorkstationMapViewProps) {
  const [zoomIndex, setZoomIndex] = useMapZoom(VIEW_ZOOM_STORAGE_KEY, VIEW_ZOOM_LEVELS.length, VIEW_ZOOM_DEFAULT_INDEX)
  const zoom = VIEW_ZOOM_LEVELS[zoomIndex]
  const [unplacedOpen, setUnplacedOpen] = useState(false)
  // Sơ đồ: vị trí máy do quản trị viên đặt nên Shift+click sắp theo vị trí trên màn hình (không theo thứ tự DOM).
  const dragSelect = useDragSelect({ selected, onChange: onChangeSelection, spatialOrder: true })
  const entries = useMemo(
    () =>
      new Map(
        machines.map((machine) => [
          hostKey(machine.hostName),
          { machine, view: getWorkstationIconView(machine, getIconContext(machine)) },
        ]),
      ),
    [machines, getIconContext],
  )
  const onMap = useMemo(() => placedHosts(layout), [layout])
  const unplaced = useMemo(
    () => machines.filter((machine) => !onMap.has(hostKey(machine.hostName))),
    [machines, onMap],
  )

  return (
    <div className="ws-icon-view" onPointerDown={dragSelect.onPointerDown}>
      <IconViewBar
        total={visibleCount}
        allSelected={allVisibleSelected}
        onSelectAll={onSelectAll}
        afterSelectAll={
          unplaced.length > 0 ? (
            <Button
              type="button"
              variant="neutral"
              className="wsmap-unplaced__toggle"
              icon={
                unplacedOpen ? (
                  <CaretUp size={14} weight="bold" aria-hidden="true" />
                ) : (
                  <CaretDown size={14} weight="bold" aria-hidden="true" />
                )
              }
              aria-expanded={unplacedOpen}
              aria-controls="wsmap-unplaced-grid"
              onClick={() => setUnplacedOpen((v) => !v)}
            >
              Chưa xếp vị trí ({unplaced.length})
            </Button>
          ) : null
        }
        trailing={<MapZoomSlider value={zoomIndex} labels={ZOOM_LABELS} onChange={setZoomIndex} ariaLabel="Phóng to / thu nhỏ sơ đồ" />}
      />
      {unplaced.length > 0 && unplacedOpen ? (
        <section className="wsmap-unplaced" aria-label="Máy chưa xếp vị trí trên sơ đồ">
          <header>
            <small>Máy chưa xếp vị trí — quản trị viên xếp trong Cài đặt → Sơ đồ máy trạm.</small>
          </header>
          <div className="ws-icon-view__grid ws-icon-view__grid--scaled wsmap-unplaced__grid" id="wsmap-unplaced-grid" role="list">
            {unplaced.map((machine) => {
              const entry = entries.get(hostKey(machine.hostName))
              if (!entry) return null
              return (
                <div
                  key={machine.hostName}
                  role="listitem"
                  className={visibleHosts.has(hostKey(machine.hostName)) ? undefined : 'wsmap-dim'}
                >
                  <WorkstationTile
                    machine={machine}
                    view={entry.view}
                    selected={selected.has(machine.hostName)}
                    onOpen={onOpen}
                    onToggle={onToggle}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ) : null}
      <div style={{ overflow: 'auto', paddingTop: '1rem' }}>
        <MapCanvas
          layout={layout}
          mode="view"
          zoom={zoom}
          cell={`${CELL_WIDTH_REM * zoom}rem`}
          cellHeight={`${CELL_HEIGHT_REM * zoom}rem`}
          renderPc={(item) => {
            const entry = entries.get(hostKey(item.host))
            // Máy có trên sơ đồ nhưng không còn trong danh sách (đã gỡ / đổi tên): khung nét đứt, không bấm được.
            if (!entry) {
              return (
                <div className="wsmap__ghost" title="Máy này không còn trong danh sách máy trạm">
                  {item.host}
                </div>
              )
            }
            return (
              <div className={`wsmap__machine${visibleHosts.has(hostKey(item.host)) ? '' : ' wsmap-dim'}`}>
                <WorkstationTile
                  machine={entry.machine}
                  view={entry.view}
                  selected={selected.has(entry.machine.hostName)}
                  onOpen={onOpen}
                  onToggle={onToggle}
                />
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
