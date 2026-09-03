import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteCombo, getComboCatalog, saveCombo, type Combo } from '../../api/combo'
import { getMachineGroups } from '../../api/machine-groups'
import { getServices } from '../../api/services'
import { Select, Button, ConfirmAction, Dialog, InlineAlert, PageHeader, StateView, StatusBadge } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import './combos.css'

const WEEKDAYS = [
  ['Thứ 2', 1 << 1], ['Thứ 3', 1 << 2], ['Thứ 4', 1 << 3], ['Thứ 5', 1 << 4],
  ['Thứ 6', 1 << 5], ['Thứ 7', 1 << 6], ['Chủ nhật', 1 << 0],
] as const

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function emptyCombo(order: number): Combo {
  return { comboId: 0, name: '', price: 0, type: 1, preAlias: '', status: 1, order,
    numOfDay: 1, weekday: 127, include: '', duration: 1, saleFrom: '00:00:00',
    saleTo: '00:00:00', display: 1, salableNow: false, machineGroups: [], donates: [] }
}

export function ComboWorkspace() {
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  const hasRight = useAuthStore((state) => state.hasRight)
  const canCreate = hasRight(6011)
  const canEdit = hasRight(6012)
  const canDelete = hasRight(6013)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Combo | null>(null)
  const [deleting, setDeleting] = useState<Combo | null>(null)

  const comboStatus = showInactive ? 'all' : 'active'
  const comboQuery = useQuery({
    queryKey: ['combos', comboStatus],
    queryFn: () => getComboCatalog(comboStatus),
  })
  const machineQuery = useQuery({ queryKey: ['machine-groups'], queryFn: getMachineGroups })
  const serviceQuery = useQuery({ queryKey: ['services'], queryFn: getServices })
  const combos = useMemo(() => comboQuery.data?.items ?? [], [comboQuery.data])
  const slots = useMemo(() => Array.from({ length: 20 }, (_, order) => ({ order, combo: combos.find((item) => item.order === order) })), [combos])
  const outsideSlots = combos.filter((item) => item.order < 0 || item.order > 19)

  const saveMutation = useMutation({
    mutationFn: (combo: Combo) => {
      if (!staffId) throw new Error('Phiên đăng nhập không có mã nhân viên.')
      return saveCombo({ ...combo, staffId, machineGroups: combo.machineGroups.map(({ machineGroupId, fromTime, toTime }) => ({ machineGroupId, fromTime, toTime })), donates: combo.donates.map(({ serviceId, quantity, provider, product, code }) => ({ serviceId, quantity, provider, product, code })) })
    },
    onSuccess: () => { setEditing(null); pushToast('Đã lưu COMBO.', 'success'); void queryClient.invalidateQueries({ queryKey: ['combos'] }) },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })
  const deleteMutation = useMutation({
    mutationFn: (combo: Combo) => {
      if (!staffId) throw new Error('Phiên đăng nhập không có mã nhân viên.')
      return deleteCombo({ staffId, comboId: combo.comboId })
    },
    onSuccess: (result) => { setDeleting(null); pushToast(result.softDeleted ? 'COMBO có lịch sử bán đã được ngừng hoạt động.' : 'Đã xóa COMBO.', 'success'); void queryClient.invalidateQueries({ queryKey: ['combos'] }) },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  return <div className="combo-workspace">
    <PageHeader eyebrow="Quản lý" title="COMBO" description="20 vị trí bán nhanh như Qt, cùng một biểu mẫu cho thêm và chỉnh sửa." actions={<Button loading={comboQuery.isFetching} onClick={() => void comboQuery.refetch()}>Làm mới</Button>} />
    <div className="combo-toolbar">
      <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Hiện COMBO đã ngừng bán</label>
      <span>{combos.length} COMBO</span>
    </div>
    {comboQuery.isLoading ? <StateView title="Đang tải danh mục COMBO…" /> : comboQuery.isError ? <StateView title="Không tải được danh mục COMBO" description={(comboQuery.error as Error).message} action={<Button onClick={() => void comboQuery.refetch()}>Thử lại</Button>} /> : <>
      <section className="combo-slot-grid" aria-label="20 vị trí COMBO">
        {slots.map(({ order, combo }) => combo ? <article className={`combo-card ${combo.status !== 1 ? 'combo-card--inactive' : ''}`} key={order}>
          <div className="combo-card__top"><span>Vị trí {order + 1}</span><StatusBadge tone={combo.status !== 1 ? 'neutral' : combo.salableNow ? 'success' : 'warning'}>{combo.status !== 1 ? 'Ngừng bán' : combo.salableNow ? 'Đang bán' : 'Ngoài giờ'}</StatusBadge></div>
          <strong>{combo.name}</strong><b>{formatMoney(combo.price)}</b>
          <small>{combo.duration > 0 ? `${combo.duration} tiếng` : 'Không giới hạn thời lượng'} · {combo.machineGroups.map((group) => group.name).join(', ') || 'Chưa có nhóm máy'}</small>
          <div className="combo-card__actions"><Button variant="ghost" className="combo-card__action combo-card__action--edit" disabled={!canEdit} onClick={() => setEditing(combo)}>Sửa</Button><Button variant="ghost" className="combo-card__action combo-card__action--delete" disabled={!canDelete} onClick={() => setDeleting(combo)}>Xóa</Button></div>
        </article> : <button className="combo-empty-slot" key={order} disabled={!canCreate} onClick={() => setEditing(emptyCombo(order))}><span>Vị trí {order + 1}</span><strong>＋ Thêm COMBO</strong></button>)}
      </section>
      {outsideSlots.length ? <InlineAlert tone="warning"><strong>{outsideSlots.length} COMBO ngoài 20 vị trí.</strong> Dữ liệu vẫn được hiển thị để sửa: {outsideSlots.map((item) => `${item.name} (#${item.comboId}, vị trí ${item.order})`).join('; ')}.</InlineAlert> : null}
    </>}

    <ComboEditor combo={editing} machineGroups={machineQuery.data ?? []} services={serviceQuery.data ?? []} pending={saveMutation.isPending} onClose={() => setEditing(null)} onSave={(combo) => saveMutation.mutate(combo)} />
    <ConfirmAction open={deleting !== null} title="Xóa COMBO?" description="COMBO đã phát sinh lịch sử bán sẽ được ngừng hoạt động thay vì xóa dữ liệu." confirmLabel="Xóa COMBO" danger pending={deleteMutation.isPending} onCancel={() => setDeleting(null)} onConfirm={() => deleting && deleteMutation.mutate(deleting)}>{deleting ? <p><strong>{deleting.name}</strong> · {formatMoney(deleting.price)}</p> : null}</ConfirmAction>
  </div>
}

type EditorProps = { combo: Combo | null; machineGroups: Array<{ id: number; name: string }>; services: Array<{ id: number; name: string; unit: string }>; pending: boolean; onClose: () => void; onSave: (combo: Combo) => void }

function ComboEditor({ combo, machineGroups, services, pending, onClose, onSave }: EditorProps) {
  const [draft, setDraft] = useState<Combo | null>(combo)
  const [usageFrom, setUsageFrom] = useState(0)
  const [usageTo, setUsageTo] = useState(0)
  const [customSaleTime, setCustomSaleTime] = useState(false)

  useEffect(() => {
    const next = combo ? structuredClone(combo) : null
    setDraft(next)
    const firstUsage = next?.machineGroups[0]
    setUsageFrom(firstUsage?.fromTime ?? 0)
    setUsageTo(firstUsage?.toTime ?? 0)
    setCustomSaleTime(Boolean(next && (next.saleFrom !== '00:00:00' || next.saleTo !== '00:00:00')))
  }, [combo])

  if (!draft) return null
  const set = <K extends keyof Combo>(key: K, value: Combo[K]) => setDraft({ ...draft, [key]: value })
  const syncUsage = (fromTime: number, toTime: number) => {
    setUsageFrom(fromTime)
    setUsageTo(toTime)
    set('machineGroups', draft.machineGroups.map((group) => ({ ...group, fromTime, toTime })))
  }
  const fixedDuration = usageFrom === usageTo ? 24 : (usageTo - usageFrom + 24) % 24
  const valid = draft.name.trim() && draft.preAlias.trim() && draft.price >= 0 && draft.order >= 0 && draft.order <= 19 && draft.numOfDay >= 1 && (draft.type === 1 || draft.duration >= 1) && draft.machineGroups.length > 0
  const save = () => onSave({
    ...draft,
    name: draft.name.trim(),
    preAlias: draft.preAlias.trim(),
    duration: draft.type === 1 ? fixedDuration : draft.duration,
    saleFrom: customSaleTime ? draft.saleFrom : '00:00:00',
    saleTo: customSaleTime ? draft.saleTo : '00:00:00',
    machineGroups: draft.machineGroups.map((group) => ({ ...group, fromTime: usageFrom, toTime: usageTo })),
  })

  return <Dialog open title={draft.comboId ? 'Chỉnh sửa COMBO' : 'Thêm COMBO'} description="Thời gian sử dụng áp dụng chung; nhóm máy chỉ xác định nơi dùng được COMBO." size="lg" onClose={onClose} footer={<><Button onClick={onClose}>Đóng</Button><Button variant="primary" loading={pending} disabled={!valid} onClick={save}>Lưu COMBO</Button></>}>
    <div className="combo-form">
      <label className="ds-field"><span className="ds-field__label">Tên COMBO</span><input className="ds-input" value={draft.name} maxLength={100} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="ds-field"><span className="ds-field__label">Tiền tố tài khoản</span><input className="ds-input" value={draft.preAlias} maxLength={20} onChange={(e) => set('preAlias', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} /></label>
      <label className="ds-field"><span className="ds-field__label">Giá bán (đ)</span><input className="ds-input" type="number" min="0" value={draft.price} onChange={(e) => set('price', Number(e.target.value))} /></label>
      <label className="ds-field"><span className="ds-field__label">Số ngày hiệu lực</span><input className="ds-input" type="number" min="1" value={draft.numOfDay} onChange={(e) => set('numOfDay', Number(e.target.value))} /></label>
      <label className="combo-check"><input type="checkbox" checked={draft.status === 1} onChange={(e) => set('status', e.target.checked ? 1 : 0)} /> Đang hoạt động</label>
      <label className="combo-check"><input type="checkbox" checked={draft.display === 1} onChange={(e) => set('display', e.target.checked ? 1 : 0)} /> Bán tại máy trạm</label>

      <fieldset className="combo-form__wide combo-usage-settings">
        <legend>Cách sử dụng</legend>
        <div className="combo-usage-settings__modes">
          <label><input type="radio" name="combo-usage-type" checked={draft.type === 1} onChange={() => set('type', 1)} /> Khung giờ cố định</label>
          <label><input type="radio" name="combo-usage-type" checked={draft.type === 2} onChange={() => set('type', 2)} /> Theo thời lượng</label>
        </div>
        <div className="combo-usage-settings__time">
          <label className="ds-field"><span className="ds-field__label">Từ</span><Select className="ds-input" value={usageFrom} onChange={(e) => syncUsage(Number(e.target.value), usageTo)}>{HOURS.map((hour) => <option value={hour} key={hour}>{String(hour).padStart(2, '0')}:00</option>)}</Select></label>
          {draft.type === 1 ? <>
            <span className="combo-usage-settings__arrow" aria-hidden="true">→</span>
            <label className="ds-field"><span className="ds-field__label">Đến</span><Select className="ds-input" value={usageTo} onChange={(e) => syncUsage(usageFrom, Number(e.target.value))}>{HOURS.map((hour) => <option value={hour} key={hour}>{String(hour).padStart(2, '0')}:00</option>)}</Select></label>
            <div className="combo-usage-settings__summary"><span>Thời lượng khung</span><strong>{fixedDuration} tiếng</strong></div>
          </> : <label className="ds-field"><span className="ds-field__label">Thời lượng</span><input className="ds-input" type="number" min="1" max="24" value={draft.duration} onChange={(e) => set('duration', Number(e.target.value))} /></label>}
        </div>
      </fieldset>

      <fieldset className="combo-form__wide combo-sale-window">
        <label><input type="checkbox" checked={customSaleTime} onChange={(e) => setCustomSaleTime(e.target.checked)} /> Tùy chỉnh thời gian bán</label>
        {customSaleTime ? <div>
          <label className="ds-field"><span className="ds-field__label">Từ</span><input className="ds-input" type="time" value={draft.saleFrom.slice(0, 5)} onChange={(e) => set('saleFrom', `${e.target.value}:00`)} /></label>
          <span aria-hidden="true">→</span>
          <label className="ds-field"><span className="ds-field__label">Đến</span><input className="ds-input" type="time" value={draft.saleTo.slice(0, 5)} onChange={(e) => set('saleTo', `${e.target.value}:00`)} /></label>
        </div> : <small>Không giới hạn khung giờ bán.</small>}
      </fieldset>

      <fieldset className="combo-form__wide"><legend>Ngày áp dụng</legend><div className="combo-weekdays">{WEEKDAYS.map(([label, bit]) => <label key={bit}><input type="checkbox" checked={(draft.weekday & bit) !== 0} onChange={(e) => set('weekday', e.target.checked ? draft.weekday | bit : draft.weekday & ~bit)} /> {label}</label>)}</div></fieldset>
      <fieldset className="combo-form__wide"><legend>Nhóm máy áp dụng</legend><p className="combo-field-help">Chọn nơi được sử dụng; tất cả nhóm dùng chung thời gian phía trên.</p><div className="combo-machine-list">{machineGroups.map((group) => { const selected = draft.machineGroups.some((item) => item.machineGroupId === group.id); return <label key={group.id} className={selected ? 'is-selected' : ''}><input type="checkbox" checked={selected} onChange={(e) => set('machineGroups', e.target.checked ? [...draft.machineGroups, { machineGroupId: group.id, name: group.name, fromTime: usageFrom, toTime: usageTo }] : draft.machineGroups.filter((item) => item.machineGroupId !== group.id))} /> {group.name}</label> })}</div></fieldset>
      <fieldset className="combo-form__wide"><legend>Dịch vụ tặng kèm</legend><div className="combo-donates">{draft.donates.map((donate, index) => <div key={`${donate.serviceId}-${index}`}><Select className="ds-input" value={donate.serviceId} onChange={(e) => { const service = services.find((item) => item.id === Number(e.target.value)); set('donates', draft.donates.map((item, i) => i === index ? { ...item, serviceId: service?.id ?? 0, name: service?.name ?? '', unit: service?.unit ?? '' } : item)) }}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</Select><input className="ds-input" aria-label="Số lượng quà tặng" type="number" min="1" value={donate.quantity} onChange={(e) => set('donates', draft.donates.map((item, i) => i === index ? { ...item, quantity: Number(e.target.value) } : item))} /><Button variant="ghost" onClick={() => set('donates', draft.donates.filter((_, i) => i !== index))}>Bỏ</Button></div>)}<Button disabled={!services.length} onClick={() => { const service = services[0]; set('donates', [...draft.donates, { serviceId: service.id, name: service.name, unit: service.unit, quantity: 1, provider: '', product: '', code: '' }]) }}>＋ Thêm dịch vụ</Button></div></fieldset>
      <label className="ds-field combo-form__wide"><span className="ds-field__label">Mô tả / quà tặng</span><textarea className="ds-input" rows={2} value={draft.include} onChange={(e) => set('include', e.target.value)} /></label>
    </div>
    {!draft.machineGroups.length ? <InlineAlert tone="warning">Phải chọn ít nhất một nhóm máy; COMBO không có nhóm máy sẽ không thể sử dụng.</InlineAlert> : null}
  </Dialog>
}
