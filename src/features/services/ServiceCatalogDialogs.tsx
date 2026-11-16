import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getUnits } from '../../api/inventory'
import {
  getServiceGroups,
  saveService,
  saveServiceGroup,
  setServiceGroupActive,
  type ServiceGroupRow,
} from '../../api/serviceCatalog'
import type { ServiceItem } from '../../api/services'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  Segmented,
  Select,
  StateView,
  StatusBadge,
  Switch,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  draftFromGroup,
  draftFromService,
  describeCatalogError,
  emptyServiceDraft,
  GROUP_TYPE_NORMAL,
  GROUP_TYPE_TOPPING,
  groupChoices,
  groupSaveBody,
  groupTypeLabel,
  groupTypeLocked,
  inventoryFlagChanged,
  nextGroupOrder,
  pendingOrdersOf,
  pendingOrderStatus,
  serviceSaveBody,
  validateGroupDraft,
  validateServiceDraft,
  validateServiceName,
  type PendingOrdersInfo,
  type ServiceDraft,
} from './serviceCatalogModel'

const money = new Intl.NumberFormat('vi-VN')

/** Làm mới mọi nơi dùng danh mục: trang này, tab Công thức/Kho (cùng danh sách dịch vụ), menu gọi món. */
function invalidateCatalog(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['services'] })
  void queryClient.invalidateQueries({ queryKey: ['inventory'] })
}

// ===== Thêm / sửa dịch vụ =====

export function ServiceEditorDialog({
  service,
  open,
  onClose,
  onPendingOrders,
}: {
  /** null = thêm mới. */
  service: ServiceItem | null
  open: boolean
  onClose: () => void
  /** Server từ chối đổi cờ quản lý tồn vì còn đơn treo ⇒ trang cha hiện danh sách đơn. */
  onPendingOrders: (info: PendingOrdersInfo, serviceName: string) => void
}) {
  const queryClient = useQueryClient()
  const unitsQuery = useQuery({ queryKey: ['inventory', 'units'], queryFn: getUnits, enabled: open })
  const groupsQuery = useQuery({ queryKey: ['services', 'groups'], queryFn: getServiceGroups, enabled: open })
  const [draft, setDraft] = useState<ServiceDraft>(emptyServiceDraft)
  const [groupKind, setGroupKind] = useState<'normal' | 'topping'>('normal')
  const [touched, setTouched] = useState(false)

  const groups = useMemo(() => groupsQuery.data?.rows ?? [], [groupsQuery.data])

  useEffect(() => {
    if (!open) return
    const next = service ? draftFromService(service) : emptyServiceDraft()
    setDraft(next)
    setTouched(false)
    setGroupKind(service?.groupTypeId === GROUP_TYPE_TOPPING ? 'topping' : 'normal')
  }, [open, service])

  const patch = (change: Partial<ServiceDraft>) => {
    setTouched(true)
    setDraft((current) => ({ ...current, ...change }))
  }

  const mutation = useMutation({
    mutationFn: () => saveService(serviceSaveBody(draft, service)),
    onSuccess: (result) => {
      pushToast(result.created ? 'Đã thêm dịch vụ.' : 'Đã lưu dịch vụ.', 'success')
      invalidateCatalog(queryClient)
      onClose()
    },
    onError: (error) => {
      const pending = pendingOrdersOf(error)
      if (pending) {
        onPendingOrders(pending, draft.name.trim() || service?.name || '')
        return
      }
      pushToast(describeCatalogError(error), 'error')
    },
  })

  const problem = validateServiceDraft(draft)
  const choices = groupChoices(groups, service?.groupId ?? 0)
  const shown = groupKind === 'topping' ? choices.topping : choices.normal
  const units = (unitsQuery.data?.rows ?? []).filter((u) => u.isActive === 1 || u.id === draft.unitId)
  const flagChanging = inventoryFlagChanged(service, draft)

  return (
    <Dialog
      open={open}
      title={service ? 'Sửa dịch vụ' : 'Thêm dịch vụ'}
      description={
        service
          ? 'Tồn kho không sửa ở đây — nhập kho/kiểm kê ở trang Kho & nguyên liệu. Ngừng bán dùng nút riêng trên thẻ món.'
          : 'Món mới có tồn = 0. Bật “Quản lý tồn kho” rồi nhập kho ở trang Kho & nguyên liệu để bán.'
      }
      onClose={mutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={mutation.isPending}
            disabled={problem !== null}
            title={problem ?? undefined}
            onClick={() => mutation.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="svc-form">
        <label className="ds-field svc-form__wide">
          <span className="ds-field__label">Tên dịch vụ</span>
          <input
            className="ds-input"
            value={draft.name}
            maxLength={50}
            autoFocus
            aria-invalid={touched && validateServiceName(draft.name) !== null}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Giá bán (đồng)</span>
          <input
            className="ds-input"
            inputMode="numeric"
            placeholder="15000"
            value={draft.price}
            onChange={(e) => patch({ price: e.target.value })}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Đơn vị tính</span>
          <Select className="ds-input" value={draft.unitId} onChange={(e) => patch({ unitId: Number(e.target.value) })}>
            <option value={0}>Chưa chọn</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit}
              </option>
            ))}
          </Select>
        </label>

        <div className="ds-field svc-form__wide">
          <span className="ds-field__label">Nhóm dịch vụ</span>
          <Segmented
            ariaLabel="Loại nhóm"
            value={groupKind}
            onChange={(kind) => {
              setGroupKind(kind)
              const list = kind === 'topping' ? choices.topping : choices.normal
              if (!list.some((g) => g.groupId === draft.groupId)) patch({ groupId: 0 })
            }}
            options={[
              { value: 'normal', label: groupTypeLabel(GROUP_TYPE_NORMAL) },
              { value: 'topping', label: groupTypeLabel(GROUP_TYPE_TOPPING) },
            ]}
          />
          <Select
            className="ds-input"
            aria-label="Nhóm dịch vụ"
            value={draft.groupId}
            onChange={(e) => patch({ groupId: Number(e.target.value) })}
          >
            <option value={0}>{shown.length === 0 ? 'Chưa có nhóm đang dùng' : 'Chọn nhóm…'}</option>
            {shown.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.active === 1 ? g.name : `${g.name} (ngừng dùng)`}
              </option>
            ))}
          </Select>
          {groupKind === 'topping' ? (
            <small className="svc-muted">Món trong nhóm topping là topping, không hiện ở menu bán lẻ.</small>
          ) : null}
        </div>

        <div className="svc-form__wide">
          <Switch
            checked={draft.inventoryManagement}
            onCheckedChange={(checked) => patch({ inventoryManagement: checked })}
            label="Quản lý tồn kho"
            description={
              draft.inventoryManagement
                ? 'Món quản lý tồn chỉ hiện ở menu bán khi còn tồn > 0 — nhập kho ở tab Kho thành phẩm.'
                : 'Không theo dõi số lượng tồn của món này.'
            }
          />
          {service ? (
            <small className="svc-muted">Chỉ đổi được khi tồn = 0 và món không còn đơn chưa hoàn tất.</small>
          ) : null}
        </div>
        {draft.inventoryManagement ? (
          <label className="ds-field svc-form__wide">
            <span className="ds-field__label">Cảnh báo khi tồn ≤ (để trống = không cảnh báo)</span>
            <input
              className="ds-input"
              inputMode="numeric"
              placeholder="Ví dụ: 5"
              value={draft.warning}
              onChange={(e) => patch({ warning: e.target.value })}
            />
          </label>
        ) : null}
        {!service ? (
          <div className="svc-form__wide">
            <Switch
              checked={draft.active}
              onCheckedChange={(checked) => patch({ active: checked })}
              label="Bán ngay"
              description="Tắt nếu muốn tạo sẵn nhưng chưa hiện ở menu."
            />
          </div>
        ) : null}
        {flagChanging ? (
          <div className="svc-form__wide">
            <InlineAlert tone="warning">
              Đổi chế độ quản lý tồn: máy chủ sẽ từ chối nếu món còn tồn hoặc còn đơn chưa hoàn tất.
            </InlineAlert>
          </div>
        ) : null}
        {touched && problem ? (
          <div className="svc-form__wide">
            <InlineAlert tone="warning">{problem}</InlineAlert>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

// ===== Đơn treo chặn đổi cờ quản lý tồn =====

export function PendingOrdersDialog({
  info,
  serviceName,
  onClose,
}: {
  info: PendingOrdersInfo | null
  serviceName: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const hidden = info ? Math.max(0, info.total - info.orders.length) : 0
  return (
    <Dialog
      open={info !== null}
      title="Món còn đơn chưa hoàn tất"
      description={`Món [${serviceName}] còn ${info?.total ?? 0} đơn — hoàn tất hoặc huỷ các đơn này trước khi đổi chế độ quản lý tồn.`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onClose()
              navigate('/orders')
            }}
          >
            Mở trang Đơn hàng
          </Button>
        </>
      }
    >
      <div className="svc-table-wrap">
        <table className="svc-table">
          <thead>
            <tr>
              <th>Khách</th>
              <th>Món</th>
              <th className="is-num">SL</th>
              <th className="is-num">Tiền</th>
              <th>Trạng thái</th>
              <th>Ngày giờ</th>
            </tr>
          </thead>
          <tbody>
            {(info?.orders ?? []).map((order) => (
              <tr key={order.serviceDetailId}>
                <td>{order.userName || `#${order.userId}`}</td>
                <td>{order.serviceName}</td>
                <td className="is-num">{order.quantity}</td>
                <td className="is-num">{money.format(order.serviceAmount)} đ</td>
                <td>
                  <StatusBadge tone={order.accept === 1 ? 'info' : 'warning'}>{pendingOrderStatus(order)}</StatusBadge>
                </td>
                <td>{`${order.serviceDate} ${order.serviceTime}`.trim()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? <p className="svc-muted">Còn {hidden} đơn nữa không hiển thị ở đây.</p> : null}
      <p className="svc-muted">Trang này không tự huỷ đơn hộ — xử lý từng đơn ở trang Đơn hàng rồi quay lại đổi.</p>
    </Dialog>
  )
}

// ===== Nhóm dịch vụ =====

export function GroupsDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const groupsQuery = useQuery({ queryKey: ['services', 'groups'], queryFn: getServiceGroups, enabled: open })
  const rows = useMemo(() => groupsQuery.data?.rows ?? [], [groupsQuery.data])
  const [editing, setEditing] = useState<{ group: ServiceGroupRow | null } | null>(null)
  const [draft, setDraft] = useState(() => draftFromGroup(null))
  const [toggling, setToggling] = useState<ServiceGroupRow | null>(null)

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setToggling(null)
    }
  }, [open])

  const startEdit = (group: ServiceGroupRow | null) => {
    setDraft(draftFromGroup(group, nextGroupOrder(rows)))
    setEditing({ group })
  }

  const saveMutation = useMutation({
    mutationFn: () => saveServiceGroup(groupSaveBody(draft, editing?.group ?? null)),
    onSuccess: (result) => {
      pushToast(result.created ? 'Đã thêm nhóm.' : 'Đã lưu nhóm.', 'success')
      setEditing(null)
      invalidateCatalog(queryClient)
    },
    onError: (error) => pushToast(describeCatalogError(error), 'error'),
  })

  const activeMutation = useMutation({
    mutationFn: (body: { groupId: number; active: boolean }) => setServiceGroupActive(body),
    onSuccess: (_result, body) => {
      pushToast(body.active ? 'Đã dùng lại nhóm.' : 'Đã ngừng dùng nhóm.', 'success')
      setToggling(null)
      invalidateCatalog(queryClient)
    },
    onError: (error) => {
      setToggling(null)
      pushToast(describeCatalogError(error), 'error')
    },
  })

  const locked = groupTypeLocked(editing?.group ?? null)
  const problem = validateGroupDraft(draft)

  return (
    <>
      <Dialog
        open={open}
        title="Nhóm dịch vụ"
        description={
          canEdit
            ? 'Thêm nhóm, đổi tên/thứ tự hiển thị, chọn nhóm thường hoặc nhóm topping, ngừng dùng hoặc dùng lại.'
            : 'Bạn chưa có quyền quản lý nhóm dịch vụ (66).'
        }
        size="lg"
        onClose={saveMutation.isPending ? () => undefined : onClose}
        footer={
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        }
      >
        <div className="svc-groups">
          {canEdit && !editing ? (
            <div>
              <Button type="button" variant="primary" onClick={() => startEdit(null)}>
                Thêm nhóm
              </Button>
            </div>
          ) : null}

          {editing ? (
            <form
              className="svc-groups__form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!problem) saveMutation.mutate()
              }}
            >
              <strong>{editing.group ? `Sửa nhóm #${editing.group.groupId}` : 'Thêm nhóm'}</strong>
              <label className="ds-field">
                <span className="ds-field__label">Tên nhóm</span>
                <input
                  className="ds-input"
                  value={draft.name}
                  maxLength={50}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="ds-field">
                <span className="ds-field__label">Thứ tự hiển thị (0–255)</span>
                <input
                  className="ds-input"
                  inputMode="numeric"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                />
              </label>
              <div className="ds-field svc-groups__wide">
                <span className="ds-field__label">Loại nhóm</span>
                <Segmented
                  ariaLabel="Loại nhóm"
                  value={draft.typeId === GROUP_TYPE_TOPPING ? 'topping' : 'normal'}
                  disabled={locked}
                  onChange={(kind) => setDraft({ ...draft, typeId: kind === 'topping' ? 2 : 0 })}
                  options={[
                    { value: 'normal', label: groupTypeLabel(GROUP_TYPE_NORMAL) },
                    { value: 'topping', label: groupTypeLabel(GROUP_TYPE_TOPPING) },
                  ]}
                />
                {locked ? (
                  <small className="svc-muted">
                    Nhóm đang có {editing.group?.serviceCount} món — chuyển món sang nhóm khác trước khi đổi loại
                    (đổi loại sẽ làm cả nhóm biến khỏi menu hoặc thành topping).
                  </small>
                ) : null}
              </div>
              {problem ? (
                <div className="svc-groups__wide">
                  <InlineAlert tone="warning">{problem}</InlineAlert>
                </div>
              ) : null}
              <div className="svc-groups__form-actions">
                <Button type="button" variant="secondary" disabled={saveMutation.isPending} onClick={() => setEditing(null)}>
                  Huỷ
                </Button>
                <Button type="submit" variant="primary" loading={saveMutation.isPending} disabled={problem !== null}>
                  Lưu nhóm
                </Button>
              </div>
            </form>
          ) : null}

          {groupsQuery.isLoading ? (
            <p className="svc-muted">Đang tải…</p>
          ) : groupsQuery.isError ? (
            <StateView title="Không tải được nhóm dịch vụ" description={describeCatalogError(groupsQuery.error)} />
          ) : groupsQuery.data && !groupsQuery.data.supported ? (
            <StateView
              title="Cơ sở dữ liệu chưa có bảng nhóm dịch vụ"
              description="Hãy khởi động lại máy chủ với phiên bản mới."
            />
          ) : rows.length === 0 ? (
            <StateView title="Chưa có nhóm nào" />
          ) : (
            <div className="svc-table-wrap">
              <table className="svc-table">
                <thead>
                  <tr>
                    <th>Nhóm</th>
                    <th>Loại</th>
                    <th className="is-num">Thứ tự</th>
                    <th className="is-num">Số món</th>
                    <th>Trạng thái</th>
                    <th aria-label="Thao tác" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((group) => (
                    <tr key={group.groupId} className={group.active === 1 ? '' : 'is-off'}>
                      <td>
                        <strong>{group.name}</strong>
                        <small className="svc-muted"> #{group.groupId}</small>
                      </td>
                      <td>{groupTypeLabel(group.typeId)}</td>
                      <td className="is-num">{group.sortOrder}</td>
                      <td className="is-num">{group.serviceCount}</td>
                      <td>
                        <StatusBadge tone={group.active === 1 ? 'success' : 'neutral'}>
                          {group.active === 1 ? 'Đang dùng' : 'Ngừng dùng'}
                        </StatusBadge>
                      </td>
                      <td className="svc-table__actions">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!canEdit || editing !== null}
                          onClick={() => startEdit(group)}
                        >
                          Sửa
                        </Button>
                        {group.active === 1 ? (
                          <Button
                            type="button"
                            variant="danger-outline"
                            disabled={!canEdit}
                            onClick={() => setToggling(group)}
                          >
                            Ngừng dùng
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!canEdit}
                            loading={activeMutation.isPending && activeMutation.variables?.groupId === group.groupId}
                            onClick={() => activeMutation.mutate({ groupId: group.groupId, active: true })}
                          >
                            Dùng lại
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Dialog>

      <ConfirmAction
        open={toggling !== null}
        title={`Ngừng dùng nhóm [${toggling?.name ?? ''}]?`}
        description={
          toggling && toggling.serviceCount > 0
            ? `Nhóm đang có ${toggling.serviceCount} món. Món trong nhóm sẽ không hiện ở menu iCafe và menu gọi món khi nhóm ngừng dùng. Dữ liệu giữ nguyên, dùng lại bất cứ lúc nào.`
            : 'Nhóm sẽ không còn được chọn khi thêm món. Dữ liệu giữ nguyên, dùng lại bất cứ lúc nào.'
        }
        confirmLabel="Ngừng dùng"
        danger
        pending={activeMutation.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => toggling && activeMutation.mutate({ groupId: toggling.groupId, active: false })}
      />
    </>
  )
}
