import {  Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PencilSimple, X } from '@phosphor-icons/react'
import { getMachineGroups } from '../../api/machine-groups'
import {
  createUserGroup,
  deleteUserGroup,
  getUserGroups,
  updateUserGroup,
  type UserGroup,
  type UserGroupWriteBody,
} from '../../api/user-groups'
import { Select,
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  MoneyInput,
  PageHeader,
  RefreshButton,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  canManageUserGroup,
  canRequestUserGroupDelete,
  groupUserGroupsByType,
  matchesUserGroup,
  supportsUserGroupPricingAndPromotion,
  userGroupTypeLabel,
  validateUserGroupDraft,
  zeroPriceMachineGroupIds,
} from './userGroupModel'
import './user-groups.css'

const RIGHT_ADD_PRICE = 51
const RIGHT_MODIFY_PRICE = 52
const RIGHT_DELETE_PRICE = 53
const RIGHT_PROMOTION = 54

type FormMode = 'create' | 'edit' | null

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function UserGroupWorkspace() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [editing, setEditing] = useState<UserGroup | null>(null)
  const [deleting, setDeleting] = useState<UserGroup | null>(null)
  const [zeroConfirmOpen, setZeroConfirmOpen] = useState(false)
  const [name, setName] = useState('')
  const [typeCode, setTypeCode] = useState<1 | 2>(2)
  const [prices, setPrices] = useState<Record<number, number | null>>({})

  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
  })
  const machineGroupsQuery = useQuery({
    queryKey: ['machine-groups'],
    queryFn: getMachineGroups,
  })

  const source = groupsQuery.data ?? []
  const machineGroups = machineGroupsQuery.data ?? []
  const visibleGroups = source.filter(
    (group) =>
      matchesUserGroup(group, search) &&
      (typeFilter === 'all' || group.type === typeFilter),
  )
  const visibleGroupSections = groupUserGroupsByType(visibleGroups)
  const canAdd = hasRight(RIGHT_ADD_PRICE)
  const canEdit = hasRight(RIGHT_MODIFY_PRICE)
  const canDelete = hasRight(RIGHT_DELETE_PRICE)
  const canPromotion = hasRight(RIGHT_PROMOTION)

  const closeForm = () => {
    setFormMode(null)
    setEditing(null)
    setZeroConfirmOpen(false)
  }

  const saveMutation = useMutation({
    mutationFn: async (body: UserGroupWriteBody) => {
      if (formMode === 'edit' && editing) {
        await updateUserGroup(editing.id, body)
      } else {
        await createUserGroup(body)
      }
    },
    onSuccess: () => {
      pushToast(
        formMode === 'edit' ? 'Đã cập nhật nhóm và bảng giá.' : 'Đã tạo nhóm và bảng giá.',
        'success',
      )
      closeForm()
      void queryClient.invalidateQueries({ queryKey: ['user-groups'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (group: UserGroup) => deleteUserGroup(group.id),
    onSuccess: () => {
      pushToast('Đã xóa nhóm và ma trận giá liên quan.', 'success')
      setDeleting(null)
      void queryClient.invalidateQueries({ queryKey: ['user-groups'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const openCreate = () => {
    setFormMode('create')
    setEditing(null)
    setName('')
    setTypeCode(2)
    setPrices(
      Object.fromEntries(machineGroups.map((group) => [group.id, 0])),
    )
  }

  const openEdit = (group: UserGroup) => {
    if (!canManageUserGroup(group)) {
      pushToast('Loại nhóm này được quản lý ở module chuyên biệt.', 'info')
      return
    }
    setFormMode('edit')
    setEditing(group)
    setName(group.name)
    setTypeCode(group.typeCode as 1 | 2)
    setPrices(
      Object.fromEntries(
        machineGroups.map((machineGroup) => [
          machineGroup.id,
          group.prices[machineGroup.id] ?? null,
        ]),
      ),
    )
  }

  const buildBody = (): UserGroupWriteBody | null => {
    const machineGroupIds = machineGroups.map((group) => group.id)
    const validationError = validateUserGroupDraft({
      name,
      prices,
      machineGroupIds,
    })
    if (validationError) {
      pushToast(validationError, 'error')
      return null
    }
    return {
      name: name.trim(),
      type: typeCode,
      active: editing?.active ?? true,
      prices: Object.fromEntries(
        machineGroupIds.map((id) => [id, prices[id] as number]),
      ),
    }
  }

  const requestSave = () => {
    const body = buildBody()
    if (!body) return
    const zeros = zeroPriceMachineGroupIds(
      prices,
      machineGroups.map((group) => group.id),
    )
    if (zeros.length > 0) {
      setZeroConfirmOpen(true)
      return
    }
    saveMutation.mutate(body)
  }

  const confirmZeroAndSave = () => {
    const body = buildBody()
    if (body) saveMutation.mutate(body)
  }

  return (
    <section className="user-group-workspace">
      <PageHeader
        eyebrow="Cấu hình tính cước"
        title="Nhóm khách hàng & bảng giá"
        description="Quản lý nhóm hội viên/vãng lai và giá giờ theo từng nhóm máy."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={!canPromotion}
              title={canPromotion ? undefined : 'Cần quyền Khuyến mãi (54).'}
              onClick={() => navigate('/promotions')}
            >
              Khuyến mãi
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canAdd || machineGroups.length === 0}
              title={
                !canAdd
                  ? 'Cần quyền Thêm bảng giá (51).'
                  : machineGroups.length === 0
                    ? 'Cần ít nhất một nhóm máy.'
                    : undefined
              }
              onClick={openCreate}
            >
              Thêm nhóm
            </Button>
          </>
        }
      />

      <InlineAlert tone="info">
        Màn này chỉ tạo/sửa nhóm <strong>Khách vãng lai</strong> và{' '}
        <strong>Hội viên</strong> như form MFC. ADMIN, nhân viên và thẻ combo được
        hiển thị để đối chiếu nhưng không bị chuyển loại hoặc ghi bằng form giá này.
      </InlineAlert>

      <section className="user-group-filters">
        <label className="ds-field">
          <span className="ds-field__label">Tìm nhóm</span>
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Tên hoặc loại nhóm…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Loại nhóm</span>
          <Select
            className="ds-select"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="anonym">Khách vãng lai</option>
            <option value="member">Hội viên</option>
            <option value="admin">Quản trị hệ thống</option>
            <option value="staff">Nhân viên</option>
            <option value="combo">Thẻ combo</option>
          </Select>
        </label>
      </section>

      <section className="user-group-panel">
        <header>
          <div>
            <strong>Ma trận giá theo nhóm máy</strong>
            <span>
              {visibleGroups.length === source.length
                ? `${visibleGroups.length} nhóm`
                : `${visibleGroups.length}/${source.length} nhóm phù hợp`}
            </span>
          </div>
          <RefreshButton
            loading={groupsQuery.isFetching || machineGroupsQuery.isFetching}
            onClick={() => {
              void groupsQuery.refetch()
              void machineGroupsQuery.refetch()
            }}
          />
        </header>

        {groupsQuery.isLoading || machineGroupsQuery.isLoading ? (
          <StateView title="Đang tải ma trận giá…" />
        ) : groupsQuery.isError || machineGroupsQuery.isError ? (
          <StateView
            title="Không tải được ma trận giá"
            description={
              groupsQuery.error instanceof Error
                ? groupsQuery.error.message
                : machineGroupsQuery.error instanceof Error
                  ? machineGroupsQuery.error.message
                  : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button
                type="button"
                onClick={() => {
                  void groupsQuery.refetch()
                  void machineGroupsQuery.refetch()
                }}
              >
                Thử lại
              </Button>
            }
          />
        ) : visibleGroups.length === 0 ? (
          <StateView
            title={search || typeFilter !== 'all' ? 'Không có nhóm phù hợp' : 'Chưa có nhóm giá'}
            description={search || typeFilter !== 'all' ? 'Thử bộ lọc khác.' : undefined}
          />
        ) : (
          <div className="user-group-table-wrap">
            <table className="user-group-table">
              <thead>
                <tr>
                  <th className="user-group-table__identity-column">Nhóm tài khoản</th>
                  <th className="user-group-table__action-column">Thao tác</th>
                  {machineGroups.map((machineGroup) => (
                    <th key={machineGroup.id}>{machineGroup.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleGroupSections.map((section) => {
                  const sectionHasPricing = section.groups.some(
                    supportsUserGroupPricingAndPromotion,
                  )
                  return (
                    <Fragment key={section.type}>
                    <tr className={`user-group-type-row${sectionHasPricing ? '' : ' is-system-type'}`}>
                      <th
                        scope="rowgroup"
                        colSpan={machineGroups.length + 2}
                      >
                        <span className="user-group-type-row__caret" aria-hidden="true">
                          {sectionHasPricing ? '▾' : '◆'}
                        </span>
                        <StatusBadge
                          tone={
                            section.type === 'member'
                              ? 'success'
                              : section.type === 'anonym'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {section.label}
                        </StatusBadge>
                        <span>
                          {sectionHasPricing
                            ? `${section.groups.length} nhóm`
                            : 'Loại hệ thống · Chỉ đọc · Không áp dụng giá hoặc khuyến mãi'}
                        </span>
                      </th>
                    </tr>
                    {sectionHasPricing ? section.groups.map((group, groupIndex) => {
                      const manageable = canManageUserGroup(group)
                      const isLastGroup = groupIndex === section.groups.length - 1
                      return (
                        <tr key={group.id} className="user-group-data-row">
                          <td className="user-group-table__identity-column">
                            <div className="user-group-tree-item">
                              <span className="user-group-tree-item__branch" aria-hidden="true">
                                {isLastGroup ? '└─' : '├─'}
                              </span>
                              <div className="user-group-tree-item__copy">
                                <strong>{group.name}</strong>
                                <span>#{group.id}</span>
                              </div>
                              {!group.active ? (
                                <StatusBadge tone="warning">Không hoạt động</StatusBadge>
                              ) : null}
                            </div>
                          </td>
                          <td className="user-group-table__action-column">
                            {manageable ? (
                              <div className="user-group-row-actions">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  icon={<PencilSimple size={16} weight="bold" aria-hidden="true" />}
                                  disabled={!canEdit}
                                  title={canEdit ? undefined : 'Cần quyền Sửa bảng giá (52).'}
                                  onClick={() => openEdit(group)}
                                >
                                  Sửa
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="user-group-row-actions__delete"
                                  icon={<X size={16} weight="bold" aria-hidden="true" />}
                                  disabled={
                                    !canDelete || !canRequestUserGroupDelete(group)
                                  }
                                  title={
                                    !canDelete
                                      ? 'Cần quyền Xóa bảng giá (53).'
                                      : !group.active
                                        ? 'MFC không cho xóa nhóm không hoạt động.'
                                        : 'Máy chủ sẽ từ chối nếu nhóm còn người dùng hoạt động.'
                                  }
                                  onClick={() => setDeleting(group)}
                                >
                                  Xóa
                                </Button>
                              </div>
                            ) : (
                              <StatusBadge tone="neutral">Chỉ đọc</StatusBadge>
                            )}
                          </td>
                          {machineGroups.map((machineGroup) => {
                            const price = group.prices[machineGroup.id]
                            return (
                              <td key={machineGroup.id}>
                                {price === undefined ? (
                                  <StatusBadge tone="warning">Thiếu giá</StatusBadge>
                                ) : (
                                  <strong className="user-group-money">
                                    {formatMoney(price)}
                                  </strong>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    }) : null}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(formMode)}
        title={formMode === 'edit' ? `Sửa ${editing?.name ?? 'nhóm giá'}` : 'Thêm nhóm giá'}
        description="Mỗi nhóm máy cần một mức giá rõ ràng; giá 0 phải được xác nhận riêng."
        size="lg"
        onClose={saveMutation.isPending ? () => undefined : closeForm}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={closeForm}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saveMutation.isPending}
              onClick={requestSave}
            >
              {formMode === 'edit' ? 'Lưu bảng giá' : 'Tạo nhóm'}
            </Button>
          </>
        }
      >
        <div className="user-group-form">
          <div className="user-group-form__identity">
            <label className="ds-field">
              <span className="ds-field__label">Tên nhóm</span>
              <input
                className="ds-input"
                value={name}
                maxLength={22}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              <small>{name.length}/22 ký tự</small>
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Loại nhóm</span>
              <Select
                className="ds-select"
                value={typeCode}
                disabled={formMode === 'edit'}
                onChange={(event) =>
                  setTypeCode(Number(event.target.value) as 1 | 2)
                }
              >
                <option value={1}>Khách vãng lai</option>
                <option value={2}>Hội viên</option>
              </Select>
              <small>Loại nhóm không thể đổi sau khi tạo.</small>
            </label>
          </div>

          <section className="user-group-price-editor">
            <header>
              <strong>Giá giờ theo nhóm máy</strong>
              <span>{machineGroups.length} nhóm máy</span>
            </header>
            <div>
              {machineGroups.map((machineGroup) => (
                <MoneyInput
                  key={machineGroup.id}
                  label={machineGroup.name}
                  value={prices[machineGroup.id] ?? null}
                  min={0}
                  max={999_999}
                  hint={
                    prices[machineGroup.id] === null
                      ? 'Đang thiếu giá; cần nhập trước khi lưu.'
                      : 'Đồng/giờ'
                  }
                  onChange={(value) =>
                    setPrices((current) => ({
                      ...current,
                      [machineGroup.id]: value,
                    }))
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </Dialog>

      <ConfirmAction
        open={zeroConfirmOpen}
        title="Xác nhận bảng giá có mức 0 đồng?"
        description="MFC yêu cầu xác nhận riêng khi một nhóm máy có giá bằng 0."
        confirmLabel="Lưu giá 0 đồng"
        pending={saveMutation.isPending}
        onCancel={() => setZeroConfirmOpen(false)}
        onConfirm={confirmZeroAndSave}
      >
        <div className="user-group-zero-list">
          {zeroPriceMachineGroupIds(
            prices,
            machineGroups.map((group) => group.id),
          ).map((id) => (
            <StatusBadge key={id} tone="warning">
              {machineGroups.find((group) => group.id === id)?.name ?? `Nhóm máy #${id}`}
            </StatusBadge>
          ))}
        </div>
      </ConfirmAction>

      <ConfirmAction
        open={Boolean(deleting)}
        title="Xóa nhóm và bảng giá?"
        description={deleting ? `${deleting.name} · ${userGroupTypeLabel(deleting.type)}` : undefined}
        confirmLabel="Xóa nhóm"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
      >
        <InlineAlert tone="danger">
          Ma trận giá của nhóm sẽ bị xóa. Máy chủ sẽ chặn nếu vẫn còn người dùng
          hoạt động thuộc nhóm này.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
