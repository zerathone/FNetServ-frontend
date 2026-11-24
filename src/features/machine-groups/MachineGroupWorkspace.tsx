import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowsClockwise, MagnifyingGlass, PencilSimple, Trash } from '@phosphor-icons/react'
import {
  createMachineGroup,
  deleteMachineGroup,
  getMachineGroups,
  updateMachineGroup,
  type MachineGroup,
  type MachineGroupWriteBody,
} from '../../api/machine-groups'
import { getRegisteredWorkstations } from '../../api/workstations'
import {
  getUserGroups,
  updateUserGroup,
  type UserGroup,
} from '../../api/user-groups'
import {
  Button,
  ConfirmAction,
  Dialog,
  IconButton,
  InlineAlert,
  MoneyInput,
  PageHeader,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  canEditAnonymPrice,
  matchesMachineGroup,
  validateMachineGroupCreateDraft,
  validateMachineGroupDraft,
  zeroPriceUserGroupIds,
} from './machineGroupModel'
import { UpdateMachineListDialog } from './UpdateMachineListDialog'
import './machine-groups.css'

const RIGHT_MACHINE_ADD = 9411
const RIGHT_MACHINE_DELETE = 9412
const RIGHT_MACHINE_EDIT = 9413
const RIGHT_MACHINE_UPDATE_LIST = 9414
const RIGHT_MODIFY_PRICE = 52

type CreateResult = {
  id: number
  savedCount: number
  failed: string[]
}

/** MFC giới hạn số nhóm máy. */
const MAX_GROUPS = 20

function formatPlainMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value)
}

export function MachineGroupWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createPrices, setCreatePrices] = useState<
    Record<number, number | null>
  >({})
  const [zeroConfirmOpen, setZeroConfirmOpen] = useState(false)
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)
  const [editing, setEditing] = useState<MachineGroup | null>(null)
  const [deleting, setDeleting] = useState<MachineGroup | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [anonymPrice, setAnonymPrice] = useState<number | null>(null)
  const [updateListOpen, setUpdateListOpen] = useState(false)

  const groupsQuery = useQuery({
    queryKey: ['machine-groups'],
    queryFn: getMachineGroups,
  })
  const userGroupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
  })

  // Danh sách máy đăng ký trong DB (đổi chậm, không cần poll) -> số máy mỗi nhóm + số máy chưa thuộc nhóm nào.
  const registeredQuery = useQuery({
    queryKey: ['workstations-registered'],
    queryFn: getRegisteredWorkstations,
    staleTime: 60_000,
  })

  const source = groupsQuery.data ?? []
  const registered = registeredQuery.data?.items
  const machineCount = new Map<number, number>()
  for (const machine of registered ?? []) {
    machineCount.set(machine.machineGroupId, (machineCount.get(machine.machineGroupId) ?? 0) + 1)
  }
  const knownGroupIds = new Set(source.map((group) => group.id))
  const unassignedCount = groupsQuery.data
    ? (registered ?? []).filter((machine) => !knownGroupIds.has(machine.machineGroupId)).length
    : 0
  const priceGroups = (userGroupsQuery.data ?? []).filter(
    (group) => group.typeCode === 1 || group.typeCode === 2,
  )
  const groups = source.filter((group) => matchesMachineGroup(group, search))
  const canAdd = hasRight(RIGHT_MACHINE_ADD)
  const canModifyPrice = hasRight(RIGHT_MODIFY_PRICE)
  const canEdit = hasRight(RIGHT_MACHINE_EDIT)
  const canDelete = hasRight(RIGHT_MACHINE_DELETE)
  const canUpdateList = hasRight(RIGHT_MACHINE_UPDATE_LIST)

  const createMutation = useMutation({
    mutationFn: async ({
      draftName,
      draftDescription,
      groups,
      prices,
    }: {
      draftName: string
      draftDescription: string
      groups: UserGroup[]
      prices: Record<number, number | null>
    }): Promise<CreateResult> => {
      const created = await createMachineGroup({
        name: draftName,
        description: draftDescription,
        active: 1,
      })
      const failed: string[] = []
      let savedCount = 0
      for (const group of groups) {
        const price = prices[group.id]
        try {
          if (price === null || price === undefined) {
            throw new Error('missing price')
          }
          await updateUserGroup(group.id, {
            name: group.name,
            type: group.typeCode,
            active: group.active,
            prices: {
              ...group.prices,
              [created.id]: price,
            },
          })
          savedCount += 1
        } catch (error) {
          failed.push(
            `${group.name}: ${
              error instanceof Error ? error.message : 'không lưu được giá'
            }`,
          )
        }
      }
      return { id: created.id, savedCount, failed }
    },
    onSuccess: (result) => {
      setCreateOpen(false)
      setZeroConfirmOpen(false)
      setCreateResult(result)
      if (result.failed.length === 0) {
        pushToast('Đã tạo nhóm máy và lưu đủ ma trận giá.', 'success')
      } else {
        pushToast(
          `Nhóm máy #${result.id} đã tạo; ${result.failed.length} bảng giá cần lưu lại.`,
          'info',
        )
      }
      void queryClient.invalidateQueries({ queryKey: ['machine-groups'] })
      void queryClient.invalidateQueries({ queryKey: ['user-groups'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: (body: MachineGroupWriteBody) => {
      if (!editing) throw new Error('Chưa chọn nhóm máy.')
      return updateMachineGroup(editing.id, body)
    },
    onSuccess: () => {
      pushToast('Đã cập nhật nhóm máy.', 'success')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['machine-groups'] })
    },
    onError: (error: Error) => {
      if (/updated but anonymPrice not saved/i.test(error.message)) {
        pushToast(
          'Tên/mô tả đã được lưu nhưng giá vãng lai chưa lưu. Danh sách đang được đọc lại.',
          'info',
        )
        void queryClient.invalidateQueries({ queryKey: ['machine-groups'] })
      } else {
        pushToast(error.message, 'error')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (group: MachineGroup) => deleteMachineGroup(group.id),
    onSuccess: () => {
      pushToast('Đã xóa nhóm máy và dữ liệu giá liên quan.', 'success')
      setDeleting(null)
      void queryClient.invalidateQueries({ queryKey: ['machine-groups'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const openEdit = (group: MachineGroup) => {
    setEditing(group)
    setName(group.name)
    setDescription(group.description)
    setAnonymPrice(group.anonymPrice)
  }

  const openCreate = () => {
    setCreateName('')
    setCreateDescription('')
    setCreatePrices(
      Object.fromEntries(priceGroups.map((group) => [group.id, 0])),
    )
    setCreateResult(null)
    setCreateOpen(true)
  }

  const createValidationError = () =>
    validateMachineGroupCreateDraft({
      name: createName,
      description: createDescription,
      priceGroupIds: priceGroups.map((group) => group.id),
      prices: createPrices,
    })

  const submitCreate = () => {
    const validationError = createValidationError()
    if (validationError) {
      pushToast(validationError, 'error')
      return
    }
    createMutation.mutate({
      draftName: createName.trim(),
      draftDescription: createDescription.trim(),
      groups: priceGroups,
      prices: createPrices,
    })
  }

  const requestCreate = () => {
    const validationError = createValidationError()
    if (validationError) {
      pushToast(validationError, 'error')
      return
    }
    if (
      zeroPriceUserGroupIds(
        createPrices,
        priceGroups.map((group) => group.id),
      ).length > 0
    ) {
      setZeroConfirmOpen(true)
      return
    }
    submitCreate()
  }

  const submitEdit = () => {
    if (!editing) return
    const priceEditable = canEditAnonymPrice(editing)
    const validationError = validateMachineGroupDraft({
      name,
      description,
      anonymPrice,
      priceEditable,
    })
    if (validationError) {
      pushToast(validationError, 'error')
      return
    }

    const body: MachineGroupWriteBody = {
      name: name.trim(),
      description: description.trim(),
    }
    if (priceEditable && anonymPrice !== null) {
      body.anonymPrice = anonymPrice
    }
    updateMutation.mutate(body)
  }

  return (
    <section className="machine-group-workspace">
      <PageHeader
        eyebrow="Cấu hình phòng máy"
        title="Nhóm máy"
        description="Mỗi nhóm máy có bảng giá riêng. Gán máy vào nhóm để tính giá theo khu vực (VIP, phòng thường…)."
        actions={
          <>
            <IconButton
              label="Làm mới danh sách"
              icon={<ArrowsClockwise size={18} weight="bold" className={groupsQuery.isFetching ? 'machine-group-spin' : undefined} />}
              variant="secondary"
              disabled={groupsQuery.isFetching}
              onClick={() => {
                void groupsQuery.refetch()
                void registeredQuery.refetch()
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!canUpdateList || source.length === 0}
              title={!canUpdateList ? 'Cần quyền Cập nhật danh sách máy (9414).' : undefined}
              onClick={() => setUpdateListOpen(true)}
            >
              Chuyển máy giữa nhóm
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                !canAdd ||
                !canModifyPrice ||
                source.length >= MAX_GROUPS ||
                userGroupsQuery.isLoading ||
                userGroupsQuery.isError ||
                priceGroups.length === 0
              }
              title={
                !canAdd
                  ? 'Cần quyền Thêm nhóm máy (9411).'
                  : !canModifyPrice
                    ? 'Cần quyền Sửa bảng giá (52) để ghi ma trận.'
                    : source.length >= MAX_GROUPS
                      ? `MFC giới hạn tối đa ${MAX_GROUPS} nhóm máy.`
                      : userGroupsQuery.isError
                        ? 'Không tải được các bảng giá.'
                        : priceGroups.length === 0
                          ? 'Chưa có bảng giá vãng lai hoặc hội viên.'
                          : undefined
              }
              onClick={openCreate}
            >
              Thêm nhóm
            </Button>
          </>
        }
      />

      {createResult?.failed.length ? (
        <InlineAlert tone="warning">
          Nhóm máy #{createResult.id} đã được tạo và lưu thành công{' '}
          {createResult.savedCount} bảng giá. Các dòng chưa lưu:{' '}
          {createResult.failed.join(' · ')}. Mở “Nhóm người dùng” để lưu lại các
          bảng giá này; dữ liệu đã thành công không bị ghi đè.
        </InlineAlert>
      ) : null}

      {unassignedCount > 0 ? (
        <InlineAlert tone="info">
          Có {unassignedCount} máy chưa thuộc nhóm nào nên chưa có giá theo nhóm.
          {canUpdateList ? (
            <>
              {' '}
              <Button type="button" variant="secondary" onClick={() => setUpdateListOpen(true)}>
                Gán máy vào nhóm
              </Button>
            </>
          ) : null}
        </InlineAlert>
      ) : null}

      <section className="machine-group-panel" aria-label="Danh sách nhóm máy">
        <div className="machine-group-toolbar">
          <div className="ds-input-group ds-input-group--search machine-group-search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                aria-label="Tìm tên hoặc mô tả nhóm máy"
                placeholder="Tìm tên hoặc mô tả…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <p className="machine-group-summary" aria-live="polite">
            {groups.length === source.length
              ? `${source.length}/${MAX_GROUPS} nhóm`
              : `${groups.length} trong ${source.length} nhóm phù hợp`}
            {registered ? ` · ${registered.length} máy` : ''}
          </p>
        </div>

        {groupsQuery.isLoading ? (
          <StateView title="Đang tải nhóm máy…" />
        ) : groupsQuery.isError ? (
          <StateView
            title="Không tải được nhóm máy"
            description={
              groupsQuery.error instanceof Error
                ? groupsQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void groupsQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : groups.length === 0 ? (
          <StateView
            title={search.trim() ? 'Không có nhóm phù hợp' : 'Chưa có nhóm máy'}
            description={
              search.trim()
                ? 'Thử từ khóa khác.'
                : canAdd
                  ? 'Bấm “Thêm nhóm” để tạo nhóm đầu tiên và nhập bảng giá.'
                  : undefined
            }
          />
        ) : (
          <div className="machine-group-table-wrap">
            <table className="machine-group-table">
              <thead>
                <tr>
                  <th scope="col">Nhóm máy</th>
                  <th scope="col" className="is-num">Số máy</th>
                  <th scope="col" className="is-num">
                    Giá vãng lai <small>đồng/giờ</small>
                  </th>
                  <th scope="col">
                    <span className="machine-group-sr">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <th scope="row" className="machine-group-table__name">
                      <strong>{group.name}</strong>
                      {group.description ? <span>{group.description}</span> : null}
                    </th>
                    <td className="is-num" data-label="Số máy">
                      {registered ? (
                        <span className={machineCount.get(group.id) ? undefined : 'machine-group-muted'}>
                          {machineCount.get(group.id) ?? 0}
                        </span>
                      ) : (
                        <span className="machine-group-muted">—</span>
                      )}
                    </td>
                    <td className="is-num" data-label="Giá vãng lai (đồng/giờ)">
                      {group.anonymPriceAmbiguous ? (
                        <div className="machine-group-price-list">
                          <StatusBadge tone="danger">Nhiều bảng giá</StatusBadge>
                          {(group.anonymPrices ?? []).map((price) => (
                            <div key={price.priceId}>
                              <span>{price.priceType || `Bảng giá #${price.priceId}`}</span>
                              <strong>{formatPlainMoney(price.price)}</strong>
                            </div>
                          ))}
                        </div>
                      ) : group.anonymPrice === null ? (
                        <StatusBadge tone="warning">Chưa cấu hình</StatusBadge>
                      ) : (
                        <strong className="machine-group-price">{formatPlainMoney(group.anonymPrice)}</strong>
                      )}
                    </td>
                    <td className="machine-group-table__actions">
                      <IconButton
                        label={`Sửa nhóm ${group.name}`}
                        icon={<PencilSimple size={18} weight="bold" />}
                        disabled={!canEdit}
                        title={canEdit ? `Sửa nhóm ${group.name}` : 'Cần quyền Sửa nhóm máy (9413).'}
                        onClick={() => openEdit(group)}
                      />
                      <IconButton
                        label={`Xóa nhóm ${group.name}`}
                        icon={<Trash size={18} weight="bold" />}
                        className="machine-group-delete"
                        disabled={!canDelete}
                        title={
                          !canDelete
                            ? 'Cần quyền Xóa nhóm máy (9412).'
                            : 'Xóa nhóm. Máy chủ sẽ từ chối nếu nhóm còn tài khoản đang hoạt động.'
                        }
                        onClick={() => setDeleting(group)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={createOpen}
        title="Thêm nhóm máy"
        description="Nhập giá cho mọi bảng vãng lai và hội viên, tương ứng danh sách giá trên form MFC."
        size="lg"
        onClose={
          createMutation.isPending
            ? () => undefined
            : () => setCreateOpen(false)
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={createMutation.isPending}
              onClick={() => setCreateOpen(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={createMutation.isPending}
              onClick={requestCreate}
            >
              Tạo nhóm và lưu giá
            </Button>
          </>
        }
      >
        <div className="machine-group-form">
          <div className="machine-group-form__identity">
            <label className="ds-field">
              <span className="ds-field__label">Tên nhóm máy</span>
              <input
                className="ds-input"
                value={createName}
                maxLength={25}
                autoFocus
                onChange={(event) => setCreateName(event.target.value)}
              />
              <small>{createName.length}/25 ký tự</small>
            </label>
            <label className="ds-field">
              <span className="ds-field__label">Mô tả</span>
              <textarea
                className="ds-textarea"
                rows={3}
                value={createDescription}
                maxLength={100}
                onChange={(event) => setCreateDescription(event.target.value)}
              />
              <small>{createDescription.length}/100 ký tự</small>
            </label>
          </div>

          <section className="machine-group-price-editor">
            <header>
              <div>
                <strong>Ma trận giá ban đầu</strong>
                <span>{priceGroups.length} bảng giá</span>
              </div>
              <StatusBadge tone="info">Đủ bảng giá</StatusBadge>
            </header>
            <div>
              {priceGroups.map((group) => (
                <MoneyInput
                  key={group.id}
                  label={group.name}
                  value={createPrices[group.id] ?? null}
                  min={0}
                  max={999_999}
                  hint={
                    group.typeCode === 1
                      ? 'Khách vãng lai · đồng/giờ'
                      : 'Hội viên · đồng/giờ'
                  }
                  onChange={(value) =>
                    setCreatePrices((current) => ({
                      ...current,
                      [group.id]: value,
                    }))
                  }
                />
              ))}
            </div>
          </section>

          <InlineAlert tone="info">
            Việc tạo gồm một lần ghi nhóm máy và các lần ghi bảng giá kế tiếp.
            Nếu kết nối lỗi giữa chừng, WebUI sẽ nêu chính xác bảng nào cần lưu lại.
          </InlineAlert>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        title={editing ? `Sửa nhóm ${editing.name}` : 'Sửa nhóm máy'}
        size="md"
        onClose={updateMutation.isPending ? () => undefined : () => setEditing(null)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={updateMutation.isPending}
              onClick={() => setEditing(null)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={updateMutation.isPending}
              onClick={submitEdit}
            >
              Lưu thay đổi
            </Button>
          </>
        }
      >
        <div className="machine-group-form">
          <label className="ds-field">
            <span className="ds-field__label">Tên nhóm máy</span>
            <input
              className="ds-input"
              value={name}
              maxLength={25}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <small>{name.length}/25 ký tự</small>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Mô tả</span>
            <textarea
              className="ds-textarea"
              rows={3}
              value={description}
              maxLength={100}
              onChange={(event) => setDescription(event.target.value)}
            />
            <small>{description.length}/100 ký tự</small>
          </label>
          {editing?.anonymPriceAmbiguous ? (
            <InlineAlert tone="warning">
              Nhóm có nhiều bảng giá vãng lai. REST không thể chọn đúng PriceId nên
              WebUI chỉ lưu tên/mô tả; hãy sửa ma trận giá trong form MFC.
            </InlineAlert>
          ) : (
            <MoneyInput
              label="Giá khách vãng lai"
              value={anonymPrice}
              min={0}
              max={999_999}
              hint={
                editing?.anonymPrice === null
                  ? 'Để trống sẽ không tạo dòng giá mới. Giá 0 là hợp lệ.'
                  : 'Đơn vị đồng/giờ; 0 là giá hợp lệ.'
              }
              onChange={setAnonymPrice}
            />
          )}
        </div>
      </Dialog>

      <ConfirmAction
        open={zeroConfirmOpen}
        title="Xác nhận ma trận có giá 0 đồng?"
        description="Form MFC cũng khởi tạo các giá mới bằng 0; cần xác nhận trước khi lưu."
        confirmLabel="Tạo với giá 0 đồng"
        pending={createMutation.isPending}
        onCancel={() => setZeroConfirmOpen(false)}
        onConfirm={submitCreate}
      >
        <div className="machine-group-zero-list">
          {zeroPriceUserGroupIds(
            createPrices,
            priceGroups.map((group) => group.id),
          ).map((id) => (
            <StatusBadge key={id} tone="warning">
              {priceGroups.find((group) => group.id === id)?.name ??
                `Bảng giá #${id}`}
            </StatusBadge>
          ))}
        </div>
      </ConfirmAction>

      <ConfirmAction
        open={Boolean(deleting)}
        title="Xóa nhóm máy?"
        description={deleting ? `${deleting.name} · #${deleting.id}` : undefined}
        confirmLabel="Xóa nhóm"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
      >
        <InlineAlert tone="danger">
          Dữ liệu giá máy của nhóm sẽ được dọn trước khi xóa. Máy chủ sẽ chặn thao
          tác nếu nhóm vẫn còn tài khoản hoạt động.
        </InlineAlert>
      </ConfirmAction>

      <UpdateMachineListDialog
        open={updateListOpen}
        groups={source}
        canManage={canUpdateList}
        onClose={() => setUpdateListOpen(false)}
      />
    </section>
  )
}
