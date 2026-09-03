import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createMachineGroup,
  deleteMachineGroup,
  getMachineGroups,
  updateMachineGroup,
  type MachineGroup,
  type MachineGroupWriteBody,
} from '../../api/machine-groups'
import {
  getUserGroups,
  updateUserGroup,
  type UserGroup,
} from '../../api/user-groups'
import {
  Button,
  ConfirmAction,
  Dialog,
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
  canRequestMachineGroupDelete,
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

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ/giờ`
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

  const source = groupsQuery.data ?? []
  const priceGroups = (userGroupsQuery.data ?? []).filter(
    (group) => group.typeCode === 1 || group.typeCode === 2,
  )
  const groups = source.filter((group) => matchesMachineGroup(group, search))
  const canAdd = hasRight(RIGHT_MACHINE_ADD)
  const canModifyPrice = hasRight(RIGHT_MODIFY_PRICE)
  const canEdit = hasRight(RIGHT_MACHINE_EDIT)
  const canDelete = hasRight(RIGHT_MACHINE_DELETE)
  const canUpdateList = hasRight(RIGHT_MACHINE_UPDATE_LIST)
  const activeCount = source.filter((group) => group.active > 0).length
  const missingPriceCount = source.filter(
    (group) => group.anonymPrice === null,
  ).length
  const ambiguousCount = source.filter(
    (group) => group.anonymPriceAmbiguous,
  ).length

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
        description="Theo dõi nhóm máy và giá vãng lai; thay đổi được bảo vệ theo ma trận giá đang cấu hình."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              loading={groupsQuery.isFetching}
              onClick={() => void groupsQuery.refetch()}
            >
              Làm mới
            </Button>
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
                source.length >= 20 ||
                userGroupsQuery.isLoading ||
                userGroupsQuery.isError ||
                priceGroups.length === 0
              }
              title={
                !canAdd
                  ? 'Cần quyền Thêm nhóm máy (9411).'
                  : !canModifyPrice
                    ? 'Cần quyền Sửa bảng giá (52) để ghi ma trận.'
                    : source.length >= 20
                      ? 'MFC giới hạn tối đa 20 nhóm máy.'
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

      <InlineAlert tone="info">
        Khi tạo, WebUI lưu nhóm rồi ghi giá cho toàn bộ bảng vãng lai/hội viên,
        đúng danh sách form MFC sử dụng. Máy chủ kiểm tra riêng quyền thêm, sửa và
        xóa nhóm máy (9411–9413).
      </InlineAlert>

      {createResult?.failed.length ? (
        <InlineAlert tone="warning">
          Nhóm máy #{createResult.id} đã được tạo và lưu thành công{' '}
          {createResult.savedCount} bảng giá. Các dòng chưa lưu:{' '}
          {createResult.failed.join(' · ')}. Mở “Nhóm người dùng” để lưu lại các
          bảng giá này; dữ liệu đã thành công không bị ghi đè.
        </InlineAlert>
      ) : null}

      <section className="machine-group-summary" aria-label="Tóm tắt nhóm máy">
        <div>
          <span>Tổng nhóm</span>
          <strong>{source.length}</strong>
          <small>MFC giới hạn tối đa 20 nhóm</small>
        </div>
        <div>
          <span>Đang hoạt động</span>
          <strong>{activeCount}</strong>
          <small>Trạng thái chỉ đọc từ máy chủ</small>
        </div>
        <div className={missingPriceCount ? 'is-warning' : ''}>
          <span>Chưa có giá vãng lai</span>
          <strong>{missingPriceCount}</strong>
          <small>Giá 0 vẫn là giá hợp lệ</small>
        </div>
        <div className={ambiguousCount ? 'is-danger' : ''}>
          <span>Giá đang mơ hồ</span>
          <strong>{ambiguousCount}</strong>
          <small>Nhiều bảng giá vãng lai</small>
        </div>
      </section>

      <label className="ds-field machine-group-search">
        <span className="ds-field__label">Tìm tên hoặc mô tả</span>
        <input
          className="ds-input"
          type="search"
          value={search}
          placeholder="Ví dụ: VIP, phòng thường…"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <section className="machine-group-panel">
        <header>
          <div>
            <strong>Danh sách nhóm máy</strong>
            <span>
              {groups.length === source.length
                ? `${groups.length} nhóm`
                : `${groups.length}/${source.length} nhóm phù hợp`}
            </span>
          </div>
          <div>
            <StatusBadge tone={canEdit ? 'success' : 'neutral'}>Sửa</StatusBadge>
            <StatusBadge tone={canDelete ? 'success' : 'neutral'}>Xóa</StatusBadge>
            <StatusBadge tone={canUpdateList ? 'success' : 'neutral'}>
              Chuyển máy
            </StatusBadge>
          </div>
        </header>

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
            description={search.trim() ? 'Thử từ khóa khác.' : undefined}
          />
        ) : (
          <div className="machine-group-grid">
            {groups.map((group) => (
              <article className="machine-group-card" key={group.id}>
                <header>
                  <div>
                    <span>#{group.id}</span>
                    <strong>{group.name}</strong>
                  </div>
                  <StatusBadge tone={group.active > 0 ? 'success' : 'neutral'}>
                    {group.active > 0 ? 'Hoạt động' : 'Không hoạt động'}
                  </StatusBadge>
                </header>
                <p>{group.description || 'Chưa có mô tả.'}</p>
                <section>
                  <span>Giá khách vãng lai</span>
                  {group.anonymPriceAmbiguous ? (
                    <>
                      <StatusBadge tone="danger">Nhiều bảng giá</StatusBadge>
                      <div className="machine-group-price-list">
                        {(group.anonymPrices ?? []).map((price) => (
                          <div key={price.priceId}>
                            <span>{price.priceType || `Bảng giá #${price.priceId}`}</span>
                            <strong>{formatMoney(price.price)}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : group.anonymPrice === null ? (
                    <StatusBadge tone="warning">Chưa cấu hình</StatusBadge>
                  ) : (
                    <strong>{formatMoney(group.anonymPrice)}</strong>
                  )}
                </section>
                <footer>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canEdit}
                    title={canEdit ? undefined : 'Cần quyền Sửa nhóm máy (9413).'}
                    onClick={() => openEdit(group)}
                  >
                    Sửa thông tin
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!canDelete || !canRequestMachineGroupDelete(group)}
                    title={
                      !canDelete
                        ? 'Cần quyền Xóa nhóm máy (9412).'
                        : group.active <= 0
                          ? 'MFC không cho xóa nhóm không hoạt động.'
                          : 'Máy chủ sẽ từ chối nếu nhóm còn tài khoản đang hoạt động.'
                    }
                    onClick={() => setDeleting(group)}
                  >
                    Xóa
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <InlineAlert tone="info">
        “Chuyển máy giữa nhóm” hỗ trợ chọn hàng loạt theo nhóm nguồn và ghi từng máy
        qua contract cập nhật danh sách máy, tương ứng form MFC.
      </InlineAlert>

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
        description="Tên và mô tả giữ giới hạn của form MFC đang vận hành."
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
