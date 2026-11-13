import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eraser, FloppyDisk, Wall } from '@phosphor-icons/react'
import {
  WORKSTATION_MAP_QUERY_KEY,
  getWorkstationMap,
  saveWorkstationMap,
} from '../../../api/workstationMap'
import type { MapDecorType, MapLayout } from '../../../api/workstationMapTypes.ts'
import { getRegisteredWorkstations } from '../../../api/workstations'
import { Button, InlineAlert, StateView, Switch } from '../../../design-system/components'
import { pushToast } from '../../../store/toast'
import { MapCanvas } from './MapCanvas'
import { writeDragPayload, type MapDragPayload } from './mapDrag.ts'
import { MapDecorGlyph } from './MapDecorGlyph'
import { MapPcTile } from './MapPcTile'
import { MapZoomSlider } from './MapZoomSlider'
import { EDITOR_ZOOM_DEFAULT_INDEX, EDITOR_ZOOM_PX, EDITOR_ZOOM_STORAGE_KEY } from './mapZoom.ts'
import { useMapZoom } from './useMapZoom'
import {
  DECOR_DEFS,
  DECOR_GROUP_LABEL,
  MAP_LIMITS,
  autoPlace,
  describeMapError,
  emptyLayout,
  hostKey,
  isPc,
  isWallPiece,
  itemAt,
  layoutsEqual,
  minimumSize,
  moveItem,
  parseLayout,
  placeItem,
  removeAt,
  resizeLayout,
  settingsOf,
  unplacedHosts,
  updateSettings,
  type DecorGroup,
} from './mapModel.ts'
import './map.css'

// Settings → "Sơ đồ máy trạm" (task ws-map): ADMIN vẽ sơ đồ phòng máy (xếp máy + tường + đồ vật làm mốc).
// Một sơ đồ cho cả quán; lưu server (GET/PUT /workstations/map) có số phiên bản `rev` để hai người không ghi đè nhau.
// Thu ngân thấy kết quả ở trang Máy trạm → chế độ Biểu tượng. Chỉ web: MFC không đọc sơ đồ này.

type Tool =
  | { kind: 'select' }
  | { kind: 'erase' }
  | { kind: 'pc'; host: string }
  | { kind: 'decor'; type: MapDecorType }

const SELECT_TOOL: Tool = { kind: 'select' }
const ZOOM_LABELS = EDITOR_ZOOM_PX.map((px) => `${Math.round((px / EDITOR_ZOOM_PX[EDITOR_ZOOM_DEFAULT_INDEX]) * 100)}%`)
const DECOR_GROUP_ORDER: DecorGroup[] = ['structure', 'furniture', 'game']

function naturalSort(values: string[]) {
  return [...values].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' }))
}

export function WorkstationMapEditor({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const mapQuery = useQuery({
    queryKey: WORKSTATION_MAP_QUERY_KEY,
    queryFn: getWorkstationMap,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const registeredQuery = useQuery({
    queryKey: ['workstations-registered'],
    queryFn: getRegisteredWorkstations,
    staleTime: 60_000,
  })

  // `draft` = bản đang sửa; `draftRef` luôn là bản mới nhất ĐỒNG BỘ — kéo-thả / tô liên tiếp bắn nhiều sự kiện
  // trước khi React kịp vẽ lại, đọc state sẽ bị cũ và mất ô.
  const [draft, setDraft] = useState<MapLayout | null>(null)
  const draftRef = useRef<MapLayout | null>(null)
  const savedRef = useRef<MapLayout | null>(null)
  const [baseRev, setBaseRev] = useState(0)
  const [tool, setToolState] = useState<Tool>(SELECT_TOOL)
  const toolRef = useRef<Tool>(SELECT_TOOL)
  const [selected, setSelected] = useState<{ c: number; r: number } | null>(null)
  const [zoomIndex, setZoomIndex] = useMapZoom(EDITOR_ZOOM_STORAGE_KEY, EDITOR_ZOOM_PX.length, EDITOR_ZOOM_DEFAULT_INDEX)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const painting = useRef(false)

  const setTool = useCallback((next: Tool) => {
    toolRef.current = next
    setToolState(next)
  }, [])

  const commit = useCallback((change: (layout: MapLayout) => MapLayout) => {
    const current = draftRef.current
    if (!current) return false
    const next = change(current)
    if (next === current) return false
    draftRef.current = next
    setDraft(next)
    return true
  }, [])

  const hosts = useMemo(
    () => naturalSort((registeredQuery.data?.items ?? []).map((item) => item.hostName)),
    [registeredQuery.data],
  )
  const hostsRef = useRef<string[]>([])
  hostsRef.current = hosts

  // Nạp bản server vào `draft` MỘT lần (và mỗi lần bấm "Tải lại"). Server cũ chưa có route ⇒ lỗi ⇒ báo ở dưới.
  const loadFromServer = useCallback(
    (response: { exists: boolean; rev: number; layout: unknown }) => {
      const parsed = response.exists ? parseLayout(response.layout) : null
      const layout = parsed ?? emptyLayout()
      draftRef.current = layout
      savedRef.current = layout
      setDraft(layout)
      setBaseRev(response.exists ? response.rev : 0)
      setSelected(null)
      setTool(SELECT_TOOL)
      setConflict(false)
      setError('')
    },
    [setTool],
  )

  useEffect(() => {
    if (mapQuery.data && draftRef.current === null) loadFromServer(mapQuery.data)
  }, [mapQuery.data, loadFromServer])

  const dirty = Boolean(draft && savedRef.current && !layoutsEqual(draft, savedRef.current))

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    const stop = () => {
      painting.current = false
    }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const saveMutation = useMutation({
    mutationFn: (payload: { rev: number; layout: MapLayout }) => saveWorkstationMap(payload),
    onSuccess: (result, payload) => {
      savedRef.current = payload.layout
      setBaseRev(result.rev)
      setError('')
      setConflict(false)
      pushToast('Đã lưu sơ đồ máy trạm', 'success')
      void queryClient.invalidateQueries({ queryKey: WORKSTATION_MAP_QUERY_KEY })
    },
    onError: (err) => {
      setConflict((err as { code?: string } | null)?.code === 'MAP_CONFLICT')
      setError(describeMapError(err))
    },
  })

  const reload = async () => {
    const result = await mapQuery.refetch()
    if (result.data) loadFromServer(result.data)
  }

  // ---- thao tác trên lưới ----

  /** Sau khi đặt xong một máy: tự chọn tiếp máy chưa xếp kế tiếp để xếp liền tay; hết máy thì về chế độ chọn. */
  const advancePcTool = (layout: MapLayout) => {
    const next = unplacedHosts(layout, hostsRef.current)[0]
    setTool(next ? { kind: 'pc', host: next } : SELECT_TOOL)
  }

  const applyTool = (c: number, r: number, fromPaint: boolean) => {
    const current = toolRef.current
    const layout = draftRef.current
    if (!layout) return
    const existing = itemAt(layout, c, r)

    if (current.kind === 'erase') {
      if (existing && commit((l) => removeAt(l, c, r))) setSelected(null)
      return
    }
    if (current.kind === 'pc') {
      if (existing) return
      if (commit((l) => placeItem(l, { t: 'pc', host: current.host, c, r }))) {
        advancePcTool(draftRef.current ?? layout)
      }
      return
    }
    if (current.kind === 'decor') {
      if (!existing) commit((l) => placeItem(l, { t: current.type, c, r }))
      return
    }
    // select: kéo-tô không có nghĩa ở chế độ chọn
    if (fromPaint) return
    if (existing) {
      setSelected({ c, r })
      return
    }
    if (selected && commit((l) => moveItem(l, selected, { c, r }))) setSelected({ c, r })
  }

  const handleCellDrop = (c: number, r: number, payload: MapDragPayload) => {
    if (payload.kind === 'move') {
      if (commit((l) => moveItem(l, { c: payload.c, r: payload.r }, { c, r }))) setSelected({ c, r })
    } else if (payload.kind === 'pc') {
      if (commit((l) => placeItem(l, { t: 'pc', host: payload.host, c, r }))) advancePcTool(draftRef.current ?? emptyLayout())
    } else {
      commit((l) => placeItem(l, { t: payload.type, c, r }))
    }
  }

  const handleRemove = (c: number, r: number) => {
    if (commit((l) => removeAt(l, c, r))) setSelected(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'Escape') {
      setTool(SELECT_TOOL)
      setSelected(null)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault()
      handleRemove(selected.c, selected.r)
    }
  }

  const handleAutoPlace = () => {
    const layout = draftRef.current
    if (!layout) return
    const result = autoPlace(layout, hostsRef.current)
    if (result.placed === 0) {
      pushToast(
        unplacedHosts(layout, hostsRef.current).length === 0
          ? 'Mọi máy đã có trên sơ đồ'
          : 'Hết ô trống — hãy tăng số cột / hàng',
        'info',
      )
      return
    }
    draftRef.current = result.layout
    setDraft(result.layout)
    setTool(SELECT_TOOL)
    const left = unplacedHosts(result.layout, hostsRef.current).length
    pushToast(left === 0 ? `Đã xếp ${result.placed} máy` : `Đã xếp ${result.placed} máy, còn ${left} máy hết ô`, 'success')
  }

  // ---- hiển thị ----

  if (mapQuery.isLoading) {
    return (
      <section className="settings-section">
        <StateView title="Đang tải sơ đồ máy trạm" />
      </section>
    )
  }
  if (mapQuery.isError || !draft) {
    return (
      <section className="settings-section">
        <header>
          <h2>Sơ đồ máy trạm</h2>
        </header>
        <InlineAlert tone="warning">
          Không tải được sơ đồ máy trạm. Máy chủ có thể là bản cũ chưa hỗ trợ sơ đồ — hãy cập nhật Server rồi thử lại.
        </InlineAlert>
        <footer>
          <Button type="button" variant="secondary" onClick={() => void mapQuery.refetch()}>
            Thử lại
          </Button>
        </footer>
      </section>
    )
  }

  const unplaced = unplacedHosts(draft, hosts)
  const knownHosts = new Set(hosts.map(hostKey))
  const orphans = draft.items.filter((item) => isPc(item) && !knownHosts.has(hostKey(item.host)))
  const minSize = minimumSize(draft)
  const cellPx = EDITOR_ZOOM_PX[zoomIndex]
  const editable = isAdmin
  const settings = settingsOf(draft)
  const activeKey =
    tool.kind === 'pc' ? `pc:${tool.host}` : tool.kind === 'decor' ? `decor:${tool.type}` : tool.kind

  const pickTool = (next: Tool, key: string) => {
    setTool(activeKey === key ? SELECT_TOOL : next)
    setSelected(null)
  }

  const removeOrphans = () => {
    commit((layout) => ({
      ...layout,
      items: layout.items.filter((item) => !(isPc(item) && !knownHosts.has(hostKey(item.host)))),
    }))
  }

  return (
    <section className="settings-section" onKeyDown={handleKeyDown}>
      <header>
        <h2>Sơ đồ máy trạm</h2>
      </header>

      {!editable ? <InlineAlert tone="info">Chỉ quản trị viên được sửa sơ đồ máy trạm. Bạn đang xem ở chế độ chỉ đọc.</InlineAlert> : null}
      {error ? (
        <InlineAlert tone="danger">
          {error}
          {conflict ? (
            <>
              {' '}
              <Button type="button" variant="secondary" onClick={() => void reload()}>
                Tải lại sơ đồ mới nhất
              </Button>
            </>
          ) : null}
        </InlineAlert>
      ) : null}

      <div className="wsmap-editor__settings">
        <Switch
          label="Dùng sơ đồ tại thu ngân"
          description="Tắt: trang Máy trạm của thu ngân chỉ hiện lưới phẳng, không có nút chuyển sang sơ đồ. Sơ đồ đã vẽ vẫn được giữ lại, bật lên là dùng được ngay."
          checked={settings.cashier.enabled}
          disabled={!editable}
          onCheckedChange={(enabled) => commit((l) => updateSettings(l, (s) => ({ ...s, cashier: { ...s.cashier, enabled } })))}
        />
      </div>

      <div className="wsmap-editor__bar">
        <label>
          Số cột
          <input
            className="ds-input"
            type="number"
            min={minSize.cols}
            max={MAP_LIMITS.maxCols}
            value={draft.cols}
            disabled={!editable}
            onChange={(event) => commit((l) => resizeLayout(l, Number(event.target.value), l.rows))}
          />
        </label>
        <label>
          Số hàng
          <input
            className="ds-input"
            type="number"
            min={minSize.rows}
            max={MAP_LIMITS.maxRows}
            value={draft.rows}
            disabled={!editable}
            onChange={(event) => commit((l) => resizeLayout(l, l.cols, Number(event.target.value)))}
          />
        </label>
        <div className="wsmap-editor__bar-end">
          <MapZoomSlider value={zoomIndex} labels={ZOOM_LABELS} onChange={setZoomIndex} ariaLabel="Phóng to / thu nhỏ sơ đồ" />
          {editable ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty || saveMutation.isPending}
                onClick={() => void reload()}
              >
                Hoàn tác thay đổi
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={saveMutation.isPending}
                disabled={!dirty}
                icon={<FloppyDisk size={18} weight="bold" aria-hidden="true" />}
                onClick={() => saveMutation.mutate({ rev: baseRev, layout: draft })}
              >
                Lưu sơ đồ
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {dirty ? <small className="wsmap-palette__hint">Có thay đổi chưa lưu.</small> : null}

      <div className="wsmap-editor">
        <div className="wsmap-editor__canvas" tabIndex={0} aria-label="Lưới sơ đồ máy trạm">
          <MapCanvas
            layout={draft}
            mode="edit"
            cell={`${cellPx}px`}
            selected={selected}
            renderPc={(item) => <MapPcTile host={item.host} orphan={!knownHosts.has(hostKey(item.host))} />}
            onCellPointerDown={
              editable
                ? (c, r) => {
                    painting.current = true
                    applyTool(c, r, false)
                  }
                : undefined
            }
            onCellPointerEnter={
              editable
                ? (c, r) => {
                    if (painting.current) applyTool(c, r, true)
                  }
                : undefined
            }
            onCellDrop={editable ? handleCellDrop : undefined}
            onRemove={editable ? handleRemove : undefined}
          />
        </div>

        {editable ? (
          <aside className="wsmap-editor__side" aria-label="Phần tử sơ đồ">
            <div className="wsmap-palette">
              <h3>Máy trạm chưa xếp ({unplaced.length})</h3>
              {unplaced.length === 0 ? (
                <p className="wsmap-palette__hint">Mọi máy trạm đã có trên sơ đồ.</p>
              ) : (
                <>
                  <div className="wsmap-palette__grid">
                    {unplaced.map((host) => (
                      <button
                        key={host}
                        type="button"
                        draggable
                        className={`wsmap-palette__item${activeKey === `pc:${host}` ? ' is-active' : ''}`}
                        onClick={() => pickTool({ kind: 'pc', host }, `pc:${host}`)}
                        onDragStart={(event) => writeDragPayload(event, { kind: 'pc', host })}
                      >
                        {host}
                      </button>
                    ))}
                  </div>
                  <p className="wsmap-palette__hint">
                    Chọn một máy rồi bấm vào ô để đặt — máy kế tiếp tự được chọn. Hoặc kéo máy thả vào ô.
                  </p>
                  <Button type="button" variant="secondary" onClick={handleAutoPlace}>
                    Xếp tự động các máy còn lại
                  </Button>
                </>
              )}
              {orphans.length > 0 ? (
                <>
                  <InlineAlert tone="warning">
                    {orphans.length} máy trên sơ đồ không còn trong danh sách máy trạm (viền đỏ nét đứt).
                  </InlineAlert>
                  <Button type="button" variant="secondary" onClick={removeOrphans}>
                    Gỡ khỏi sơ đồ
                  </Button>
                </>
              ) : null}
            </div>

            {DECOR_GROUP_ORDER.map((group) => (
              <div key={group} className="wsmap-palette">
                <h3>{DECOR_GROUP_LABEL[group]}</h3>
                <div className="wsmap-palette__grid">
                  {DECOR_DEFS.filter((def) => def.group === group).map((def) => (
                    <button
                      key={def.type}
                      type="button"
                      draggable
                      className={`wsmap-palette__item${activeKey === `decor:${def.type}` ? ' is-active' : ''}`}
                      title={
                        def.type === 'wall_h' || def.type === 'wall_v'
                          ? 'Giữ chuột và rê qua nhiều ô để vẽ liền một đoạn'
                          : isWallPiece(def.type)
                            ? def.label
                            : undefined
                      }
                      aria-label={isWallPiece(def.type) ? def.label : undefined}
                      onClick={() => pickTool({ kind: 'decor', type: def.type }, `decor:${def.type}`)}
                      onDragStart={(event) => writeDragPayload(event, { kind: 'decor', type: def.type })}
                    >
                      {isWallPiece(def.type) ? (
                        <span style={{ display: 'inline-flex', width: 24, height: 24, ['--wsmap-cell' as string]: '34px' }}>
                          <MapDecorGlyph type={def.type} />
                        </span>
                      ) : def.type === 'wall_h' ? (
                        <span className="wsmap-wall-swatch" aria-hidden="true" />
                      ) : def.type === 'wall_v' ? (
                        <span className="wsmap-wall-swatch wsmap-wall-swatch--v" aria-hidden="true" />
                      ) : (
                        <span style={{ display: 'inline-flex', width: 18, height: 18, ['--wsmap-cell' as string]: '30px' }}>
                          <MapDecorGlyph type={def.type} />
                        </span>
                      )}
                      {isWallPiece(def.type) ? null : def.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="wsmap-palette">
              <h3>Công cụ</h3>
              <div className="wsmap-palette__grid">
                <button
                  type="button"
                  className={`wsmap-palette__item wsmap-palette__item--danger${tool.kind === 'erase' ? ' is-active' : ''}`}
                  onClick={() => pickTool({ kind: 'erase' }, 'erase')}
                >
                  <Eraser size={16} weight="bold" aria-hidden="true" />
                  Xóa
                </button>
              </div>
              <p className="wsmap-palette__hint">
                <Wall size={12} aria-hidden="true" /> Không chọn gì: bấm một phần tử để chọn (hiện nút ✕), bấm ô trống để dời nó tới
                đó, hoặc kéo-thả. Phím Esc bỏ chọn, Delete xóa phần tử đang chọn. Đồ vật chỉ là dấu mốc, không có trạng thái.
              </p>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
