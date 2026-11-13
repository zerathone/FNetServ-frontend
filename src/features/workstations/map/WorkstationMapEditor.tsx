import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CaretDown,
  CaretRight,
  DotsSixVertical,
  DownloadSimple,
  Eraser,
  FloppyDisk,
  TextT,
  UploadSimple,
  Wall,
} from '@phosphor-icons/react'
import {
  WORKSTATION_MAP_QUERY_KEY,
  getWorkstationMap,
  saveWorkstationMap,
} from '../../../api/workstationMap'
import type { MapDecorType, MapLabelFont, MapLayout } from '../../../api/workstationMapTypes.ts'
import { getMachineGroups } from '../../../api/machine-groups'
import { getRegisteredWorkstations } from '../../../api/workstations'
import { Button, Dialog, InlineAlert, StateView, Switch } from '../../../design-system/components'
import { pushToast } from '../../../store/toast'
import { MapCanvas } from './MapCanvas'
import { ARRANGE_SHAPE_LABEL, arrangeByGroup, type ArrangeShape } from './mapAutoArrange.ts'
import { writeDragPayload, type MapDragPayload } from './mapDrag.ts'
import { MapDecorGlyph } from './MapDecorGlyph'
import { MapPcTile } from './MapPcTile'
import { MapZoomSlider } from './MapZoomSlider'
import { EDITOR_ZOOM_DEFAULT_INDEX, EDITOR_ZOOM_PX, EDITOR_ZOOM_STORAGE_KEY } from './mapZoom.ts'
import { useMapZoom } from './useMapZoom'
import {
  DECOR_DEFS,
  DECOR_GROUP_LABEL,
  LABEL_COLOR_PRESETS,
  LABEL_FONT_OPTIONS,
  LABEL_SIZE_PRESETS,
  MAP_LIMITS,
  describeMapError,
  emptyLayout,
  finalizeLabels,
  groupUnplaced,
  hostKey,
  isLabel,
  isPc,
  isWallPiece,
  newLabel,
  normalizeLabelFont,
  normalizeLabelSize,
  updateLabelAt,
  type LabelPatch,
  itemAt,
  layoutsEqual,
  MAP_FILE_MAX_BYTES,
  minimumSize,
  moveItem,
  parseLayout,
  parseLayoutFile,
  placeHosts,
  placeItem,
  removeAt,
  resizeLayout,
  serializeLayout,
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
  | { kind: 'group'; groupId: number }
  | { kind: 'decor'; type: MapDecorType }
  | { kind: 'label' }

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
  // Chỉ để lấy TÊN nhóm máy; lỗi / chưa tải ⇒ các nhóm hiện là "Nhóm <id>", sơ đồ vẫn dùng được.
  const machineGroupsQuery = useQuery({
    queryKey: ['machine-groups'],
    queryFn: getMachineGroups,
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
  // Nhóm đang MỞ trong khung "Máy trạm chưa xếp" (mặc định thu gọn hết khi mới vào trang).
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const toggleGroupExpanded = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  // Kết quả xếp tự động đang CHỜ người dùng xác nhận (sơ đồ hiện tại sẽ bị xóa). null = không có hộp thoại.
  const [arrangeConfirm, setArrangeConfirm] = useState<{
    shape: ArrangeShape
    layout: MapLayout
    groups: number
    pcs: number
    pcCount: number
    otherCount: number
  } | null>(null)
  const painting = useRef(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  // Vừa đặt nhãn mới ⇒ đưa con trỏ vào ô "Nội dung" để gõ ngay (xem effect bên dưới).
  const labelInputRef = useRef<HTMLInputElement>(null)
  const focusLabelInput = useRef(false)

  useEffect(() => {
    if (!focusLabelInput.current || !labelInputRef.current) return
    focusLabelInput.current = false
    labelInputRef.current.focus()
    labelInputRef.current.select()
  })

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
  // Bản mới nhất cho thao tác bấm-ô (đọc ngoài vòng vẽ lại, giống hostsRef).
  const registeredRef = useRef<{ hostName: string; machineGroupId: number }[]>([])
  registeredRef.current = registeredQuery.data?.items ?? []
  const machineGroupsRef = useRef<{ id: number; name: string }[]>([])
  machineGroupsRef.current = machineGroupsQuery.data ?? []

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

  /** Đặt cả một nhóm máy liền nhau từ ô (c,r) (phải là ô trống). Báo nếu hết ô trống giữa chừng. */
  const placeGroupAt = (c: number, r: number, groupHosts: readonly string[]) => {
    const layout = draftRef.current
    if (!layout || itemAt(layout, c, r)) return
    const result = placeHosts(layout, groupHosts, { c, r })
    if (result.placed === 0) {
      if (result.left > 0) pushToast('Hết ô trống — hãy tăng số cột / hàng', 'info')
      return
    }
    draftRef.current = result.layout
    setDraft(result.layout)
    setSelected(null)
    setTool(SELECT_TOOL)
    if (result.left > 0) pushToast(`Đã đặt ${result.placed} máy, còn ${result.left} máy hết ô — hãy tăng số cột / hàng`, 'info')
  }

  /** Đặt một nhãn mới vào ô trống (c,r), chọn nó và mở bảng thuộc tính để gõ chữ ngay. */
  const placeLabelAt = (c: number, r: number) => {
    if (!commit((l) => placeItem(l, newLabel(c, r)))) return
    setSelected({ c, r })
    setTool(SELECT_TOOL)
    focusLabelInput.current = true
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
    if (current.kind === 'group') {
      // Lấy máy chưa xếp của nhóm TẠI THỜI ĐIỂM bấm (bản đang sửa có thể đã đổi từ lúc chọn nhóm).
      const group = groupUnplaced(layout, registeredRef.current, machineGroupsRef.current).find((g) => g.id === current.groupId)
      if (!existing && group) placeGroupAt(c, r, group.hosts)
      else if (!group) setTool(SELECT_TOOL)
      return
    }
    if (current.kind === 'decor') {
      if (!existing) commit((l) => placeItem(l, { t: current.type, c, r }))
      return
    }
    if (current.kind === 'label') {
      // Mỗi lần bấm một nhãn (không kéo-tô ra hàng loạt nhãn giống nhau).
      if (!existing && !fromPaint) placeLabelAt(c, r)
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
      return
    }
    // KÉO-THẢ từ bảng phần tử là một thao tác trọn vẹn: thả xong coi như đã thoát chọn phần tử đó (không cần Esc), kể cả khi
    // ô thả không đặt được. Khác với BẤM chọn phần tử rồi bấm ô — cách đó giữ phần tử đang chọn để đặt liên tiếp
    // (tự chọn máy kế tiếp, kéo tô tường...). Cũng gỡ phần tử từng bấm chọn trước đó, tránh lần bấm ô kế tiếp đặt nhầm.
    setTool(SELECT_TOOL)
    if (payload.kind === 'pc') {
      commit((l) => placeItem(l, { t: 'pc', host: payload.host, c, r }))
    } else if (payload.kind === 'group') {
      placeGroupAt(c, r, payload.hosts)
    } else if (payload.kind === 'label') {
      placeLabelAt(c, r)
    } else {
      commit((l) => placeItem(l, { t: payload.type, c, r }))
    }
  }

  const handleRemove = (c: number, r: number) => {
    if (commit((l) => removeAt(l, c, r))) setSelected(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Hộp thoại xác nhận render qua portal nhưng phím vẫn nổi bọt lên đây — đừng xóa / bỏ chọn phần tử phía sau nó.
    if (arrangeConfirm) return
    // Đang gõ / chọn trong ô nhập (vd bảng thuộc tính nhãn): Delete/Backspace thuộc về ô đó, không xóa phần tử.
    // RIÊNG Esc vẫn bỏ chọn (đóng bảng thuộc tính nhãn) — bảng có ghi chú "Esc để thoát".
    if (
      event.key !== 'Escape' &&
      (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement)
    )
      return
    if (event.key === 'Escape') {
      setTool(SELECT_TOOL)
      setSelected(null)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault()
      handleRemove(selected.c, selected.r)
    }
  }

  /**
   * Xếp tự động theo nhóm (mapAutoArrange.ts): XÓA toàn bộ sơ đồ đang sửa rồi xếp lại mọi máy theo nhóm, số cột / hàng tự tính.
   * Chỉ đổi bản đang sửa (`draft`) — chưa lưu lên server cho tới khi bấm "Lưu sơ đồ"; "Hoàn tác thay đổi" quay về bản đã lưu.
   */
  const handleArrange = (shape: ArrangeShape) => {
    const layout = draftRef.current
    if (!layout) return
    // Chưa có TÊN nhóm thì nhãn sẽ ghi "Nhóm <id>" — thà chờ còn hơn ghi nhãn sai lên sơ đồ.
    if (!machineGroupsQuery.data) {
      setConflict(false)
      setError('Chưa tải được danh sách nhóm máy nên chưa có tên nhóm để ghi nhãn. Hãy thử lại sau ít giây.')
      return
    }
    const groups = groupUnplaced(emptyLayout(), registeredRef.current, machineGroupsRef.current)
    const result = arrangeByGroup(groups, shape, settingsOf(layout))
    if (!result.ok) {
      setConflict(false)
      setError(result.error)
      return
    }
    const next = { shape, layout: result.layout, groups: result.groups, pcs: result.pcs }
    if (layout.items.length > 0) {
      // Sơ đồ đang có nội dung ⇒ hỏi trong hộp thoại (xem <Dialog> cuối component) rồi mới áp dụng.
      const pcCount = layout.items.filter(isPc).length
      setArrangeConfirm({ ...next, pcCount, otherCount: layout.items.length - pcCount })
      return
    }
    applyArrange(next)
  }

  const applyArrange = (next: { shape: ArrangeShape; layout: MapLayout; groups: number; pcs: number }) => {
    draftRef.current = next.layout
    setDraft(next.layout)
    setSelected(null)
    setTool(SELECT_TOOL)
    setError('')
    setConflict(false)
    setArrangeConfirm(null)
    pushToast(
      `Đã xếp ${next.pcs} máy theo ${next.groups} nhóm (${next.layout.cols} cột × ${next.layout.rows} hàng). Bấm "Lưu sơ đồ" để áp dụng.`,
      'success',
    )
  }

  // ---- xuất / nhập file (vẫn MỘT sơ đồ duy nhất trên server; nhập chỉ nạp vào bản đang sửa, bấm "Lưu sơ đồ" mới ghi) ----

  const handleExport = () => {
    const layout = draftRef.current
    if (!layout) return
    const blob = new Blob([serializeLayout(layout)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    link.href = url
    link.download = `so-do-may-tram-${stamp}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // cho phép chọn lại cùng một file
    if (!file) return
    if (file.size > MAP_FILE_MAX_BYTES) {
      setError('File quá lớn so với một sơ đồ máy trạm.')
      return
    }
    if (dirty && !window.confirm('Bản đang sửa có thay đổi chưa lưu. Nhập file sẽ thay toàn bộ bản đang sửa. Tiếp tục?')) return
    const result = parseLayoutFile(await file.text())
    if (!result.ok) {
      setError(result.error)
      setConflict(false)
      return
    }
    commit(() => result.layout)
    setSelected(null)
    setTool(SELECT_TOOL)
    setError('')
    setConflict(false)
    pushToast(
      result.skipped > 0
        ? `Đã nhập sơ đồ từ file (bỏ ${result.skipped} phần tử không hợp lệ). Bấm "Lưu sơ đồ" để áp dụng.`
        : 'Đã nhập sơ đồ từ file. Bấm "Lưu sơ đồ" để áp dụng.',
      'info',
    )
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
  const unplacedGroups = groupUnplaced(draft, registeredQuery.data?.items ?? [], machineGroupsQuery.data ?? [])
  const knownHosts = new Set(hosts.map(hostKey))
  const orphans = draft.items.filter((item) => isPc(item) && !knownHosts.has(hostKey(item.host)))
  const minSize = minimumSize(draft)
  const cellPx = EDITOR_ZOOM_PX[zoomIndex]
  const editable = isAdmin
  const settings = settingsOf(draft)
  const activeKey =
    tool.kind === 'pc'
      ? `pc:${tool.host}`
      : tool.kind === 'group'
        ? `group:${tool.groupId}`
        : tool.kind === 'decor'
          ? `decor:${tool.type}`
          : tool.kind

  const pickTool = (next: Tool, key: string) => {
    setTool(activeKey === key ? SELECT_TOOL : next)
    setSelected(null)
  }

  const selectedItem = selected ? itemAt(draft, selected.c, selected.r) : undefined
  const selectedLabel = selectedItem && isLabel(selectedItem) ? selectedItem : null
  const patchSelectedLabel = (patch: LabelPatch) => {
    if (selected) commit((l) => updateLabelAt(l, selected.c, selected.r, patch))
  }
  const labelSize = selectedLabel ? normalizeLabelSize(selectedLabel.size) : 0
  const labelSizeOptions = (LABEL_SIZE_PRESETS as readonly number[]).includes(labelSize)
    ? LABEL_SIZE_PRESETS
    : [...LABEL_SIZE_PRESETS, labelSize].sort((a, b) => a - b)

  /** Lưu: chuẩn hóa nhãn (cắt khoảng trắng, nhãn trống về chữ mặc định) NGAY trong bản đang sửa để khỏi báo "chưa lưu". */
  const handleSave = () => {
    const current = draftRef.current
    if (!current) return
    const layout = finalizeLabels(current)
    if (layout !== current) {
      draftRef.current = layout
      setDraft(layout)
    }
    saveMutation.mutate({ rev: baseRev, layout })
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
        {editable ? <span className="wsmap-editor__divider" role="separator" aria-orientation="vertical" /> : null}
        {editable ? (
          <div
            className="wsmap-editor__arrange"
            role="group"
            aria-label="Xếp tự động theo nhóm"
            title="Xóa sơ đồ hiện tại và xếp lại mọi máy: cùng nhóm sát nhau, các nhóm cách 2 ô, tên nhóm ở ô đầu, tường bao quanh sơ đồ và cách nhóm 1 ô. Số cột / hàng tự tính theo kiểu chọn."
          >
            <span>Xếp tự động theo nhóm</span>
            {(['landscape', 'portrait', 'square'] as const).map((shape) => (
              <Button
                key={shape}
                type="button"
                variant="secondary"
                disabled={saveMutation.isPending}
                icon={<span className="wsmap-shape" data-shape={shape} aria-hidden="true" />}
                onClick={() => handleArrange(shape)}
              >
                {ARRANGE_SHAPE_LABEL[shape]}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="wsmap-editor__bar-end">
          <MapZoomSlider value={zoomIndex} labels={ZOOM_LABELS} onChange={setZoomIndex} ariaLabel="Phóng to / thu nhỏ sơ đồ" />
          <Button
            type="button"
            variant="secondary"
            icon={<DownloadSimple size={18} weight="bold" aria-hidden="true" />}
            onClick={handleExport}
          >
            Xuất file
          </Button>
          {editable ? (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void handleImportFile(event)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={saveMutation.isPending}
                icon={<UploadSimple size={18} weight="bold" aria-hidden="true" />}
                onClick={() => importInputRef.current?.click()}
              >
                Nhập từ file
              </Button>
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
                onClick={handleSave}
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
            {selectedLabel ? (
              <div className="wsmap-palette wsmap-labelprops" aria-label="Thuộc tính nhãn">
                <h3>
                  Nhãn đang chọn <small className="wsmap-labelprops__hint">Esc để thoát</small>
                </h3>
                <label>
                  Nội dung
                  <input
                    ref={labelInputRef}
                    className="ds-input"
                    type="text"
                    value={selectedLabel.text}
                    placeholder="Gõ nội dung nhãn"
                    onChange={(event) => patchSelectedLabel({ text: event.target.value })}
                  />
                </label>
                <div className="wsmap-labelprops__row">
                  <label>
                    Phông chữ
                    <select
                      className="ds-select"
                      value={normalizeLabelFont(selectedLabel.font)}
                      onChange={(event) => patchSelectedLabel({ font: event.target.value as MapLabelFont })}
                    >
                      {LABEL_FONT_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key} style={{ fontFamily: option.css }}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cỡ chữ
                    <select
                      className="ds-select"
                      value={labelSize}
                      onChange={(event) => patchSelectedLabel({ size: Number(event.target.value) })}
                    >
                      {labelSizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="wsmap-labelprops__colors" role="group" aria-label="Màu chữ">
                  <button
                    type="button"
                    className={`wsmap-swatch wsmap-swatch--auto${selectedLabel.color ? '' : ' is-active'}`}
                    title="Theo giao diện (sáng / tối)"
                    aria-label="Màu theo giao diện"
                    aria-pressed={!selectedLabel.color}
                    onClick={() => patchSelectedLabel({ color: null })}
                  />
                  {LABEL_COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`wsmap-swatch${selectedLabel.color === color ? ' is-active' : ''}`}
                      style={{ ['--wsmap-swatch' as string]: color }}
                      title={color}
                      aria-label={`Màu ${color}`}
                      aria-pressed={selectedLabel.color === color}
                      onClick={() => patchSelectedLabel({ color })}
                    />
                  ))}
                  <input
                    type="color"
                    className="wsmap-swatch-input"
                    title="Chọn màu khác"
                    aria-label="Chọn màu khác"
                    value={selectedLabel.color ?? '#111827'}
                    onChange={(event) => patchSelectedLabel({ color: event.target.value })}
                  />
                </div>
              </div>
            ) : null}

            <div className="wsmap-palette">
              <h3>Máy trạm chưa xếp ({unplaced.length})</h3>
              {unplaced.length === 0 ? (
                <p className="wsmap-palette__hint">Mọi máy trạm đã có trên sơ đồ.</p>
              ) : (
                <>
                  <p className="wsmap-palette__hint">
                    Chọn máy hoặc nhóm rồi bấm kéo thả vào ô
                  </p>
                  {unplacedGroups.map((group) => {
                    const groupKey = `group:${group.id}`
                    const collapsed = !expandedGroups.has(groupKey)
                    const gridId = `wsmap-palette-group-${group.id}`
                    return (
                      <div key={group.id} className="wsmap-palette__group">
                        <div className="wsmap-palette__group-row">
                          <button
                            type="button"
                            draggable
                            className={`wsmap-palette__group-head${activeKey === groupKey ? ' is-active' : ''}`}
                            title={`Đặt cả ${group.hosts.length} máy của nhóm — bấm rồi chọn ô, hoặc kéo thả vào ô`}
                            onClick={() => pickTool({ kind: 'group', groupId: group.id }, groupKey)}
                            onDragStart={(event) => writeDragPayload(event, { kind: 'group', hosts: group.hosts })}
                          >
                            <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
                            <span>{group.name}</span>
                            <small>{group.hosts.length} máy</small>
                          </button>
                          <button
                            type="button"
                            className="wsmap-palette__group-toggle"
                            aria-expanded={!collapsed}
                            aria-controls={gridId}
                            aria-label={`${collapsed ? 'Mở rộng' : 'Thu gọn'} nhóm ${group.name}`}
                            title={collapsed ? 'Mở rộng' : 'Thu gọn'}
                            onClick={() => toggleGroupExpanded(groupKey)}
                          >
                            {collapsed ? (
                              <CaretRight size={14} weight="bold" aria-hidden="true" />
                            ) : (
                              <CaretDown size={14} weight="bold" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        {collapsed ? null : (
                          <div id={gridId} className="wsmap-palette__grid">
                            {group.hosts.map((host) => (
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
                        )}
                      </div>
                    )
                  })}
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
                          ? `${def.label} — giữ chuột và rê qua nhiều ô để vẽ liền một đoạn`
                          : isWallPiece(def.type)
                            ? def.label
                            : undefined
                      }
                      aria-label={isWallPiece(def.type) || def.type === 'wall_h' || def.type === 'wall_v' ? def.label : undefined}
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
                      {/* Tường (thẳng, L, T) chỉ hiện hình — tên nằm ở tooltip / aria-label */}
                      {isWallPiece(def.type) || def.type === 'wall_h' || def.type === 'wall_v' ? null : def.label}
                    </button>
                  ))}
                  {group === 'structure' ? (
                    <button
                      type="button"
                      draggable
                      className={`wsmap-palette__item${activeKey === 'label' ? ' is-active' : ''}`}
                      title="Chữ tự gõ: bấm rồi chọn ô (hoặc kéo thả vào ô), sau đó đổi nội dung, phông, cỡ và màu ở bảng thuộc tính"
                      onClick={() => pickTool({ kind: 'label' }, 'label')}
                      onDragStart={(event) => writeDragPayload(event, { kind: 'label' })}
                    >
                      <TextT size={16} weight="bold" aria-hidden="true" />
                      Nhãn
                    </button>
                  ) : null}
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

      <Dialog
        open={arrangeConfirm !== null}
        title={arrangeConfirm ? `Xếp tự động kiểu ${ARRANGE_SHAPE_LABEL[arrangeConfirm.shape]}` : 'Xếp tự động'}
        description="Sơ đồ hiện tại sẽ bị xóa toàn bộ và xếp lại từ đầu."
        size="sm"
        onClose={() => setArrangeConfirm(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setArrangeConfirm(null)}>
              Hủy
            </Button>
            <Button type="button" variant="danger" onClick={() => arrangeConfirm && applyArrange(arrangeConfirm)}>
              Xóa và xếp lại
            </Button>
          </>
        }
      >
        {arrangeConfirm ? (
          <div className="wsmap-confirm">
            <p>Sẽ xóa:</p>
            <ul>
              <li>
                <strong>{arrangeConfirm.pcCount}</strong> máy trên sơ đồ
              </li>
              <li>
                <strong>{arrangeConfirm.otherCount}</strong> tường / đồ vật / nhãn
              </li>
            </ul>
            <p>Sau đó xếp lại:</p>
            <ul>
              <li>
                <strong>{arrangeConfirm.pcs}</strong> máy theo <strong>{arrangeConfirm.groups}</strong> nhóm
              </li>
              <li>
                Lưới <strong>{arrangeConfirm.layout.cols}</strong> cột × <strong>{arrangeConfirm.layout.rows}</strong> hàng
              </li>
            </ul>
            <InlineAlert tone="warning">
              Chưa lưu lên máy chủ cho tới khi bấm "Lưu sơ đồ". Bấm "Hoàn tác thay đổi" để quay về bản đã lưu.
            </InlineAlert>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}
