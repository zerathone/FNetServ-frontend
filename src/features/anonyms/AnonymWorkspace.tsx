import {  useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  anonymsApi,
  type AnonymousCustomer,
  type AnonymousDetailPayload,
} from '../../api/anonyms'
import { getWorkstationsRuntime } from '../../api/workstations'
import { Select,
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  PageHeader,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { isConnected } from '../workstations/workstationModel'
import { pushToast } from '../../store/toast'
import {
  maskIdCard,
  matchesAnonymous,
  validateAnonymousDetail,
} from './anonymModel'
import './anonyms.css'

const ANONYM_USER_GROUP = 1

const emptyDetail: AnonymousDetailPayload = {
  name: '',
  idCard: '',
  address: '',
}

export function AnonymWorkspace() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<AnonymousDetailPayload>(emptyDetail)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<AnonymousCustomer | null>(null)
  const [hostName, setHostName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AnonymousCustomer | null>(null)

  const customersQuery = useQuery({
    queryKey: ['anonyms'],
    queryFn: () => anonymsApi.getList(),
  })
  const workstationsQuery = useQuery({
    queryKey: ['workstations', 'runtime'],
    queryFn: getWorkstationsRuntime,
    refetchInterval: 10_000,
  })

  const customers = useMemo(
    () =>
      (customersQuery.data ?? []).filter((customer) =>
        matchesAnonymous(customer, search),
      ),
    [customersQuery.data, search],
  )
  const eligibleMachines = useMemo(
    () =>
      (workstationsQuery.data?.items ?? [])
        .filter(
          (machine) =>
            isConnected(machine) &&
            machine.userGroupType === ANONYM_USER_GROUP &&
            machine.userId > 0 &&
            machine.session !== null,
        )
        .sort((left, right) => left.hostName.localeCompare(right.hostName, 'vi')),
    [workstationsQuery.data],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validation = validateAnonymousDetail(detail)
      if (validation) throw new Error(validation)
      const payload = {
        ...detail,
        name: detail.name.trim(),
        idCard: detail.idCard.trim(),
        address: detail.address.trim(),
      }
      if (payload.id) {
        await anonymsApi.update(
          payload as AnonymousDetailPayload & { id: number },
        )
      } else {
        await anonymsApi.create(payload)
      }
    },
    onSuccess: () => {
      setDetailOpen(false)
      setDetail(emptyDetail)
      setDetailError(null)
      pushToast('Đã lưu hồ sơ khách vãng lai.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['anonyms'] })
    },
    onError: (error: Error) => {
      setDetailError(error.message)
      pushToast(error.message, 'error')
    },
  })

  const assignMutation = useMutation({
    mutationFn: () => {
      if (!assignTarget || !hostName) {
        throw new Error('Hãy chọn khách và máy vãng lai đang online.')
      }
      return anonymsApi.assignSession({
        hostName,
        anonymId: assignTarget.id,
      })
    },
    onSuccess: (response) => {
      const assignedHost = hostName
      setAssignTarget(null)
      setHostName('')
      pushToast(
        response.clientUpdated
          ? `Đã gắn CCCD vào ${assignedHost}.`
          : 'CSDL đã cập nhật nhưng máy vừa mất kết nối; cần kiểm tra lại phiên.',
        response.clientUpdated ? 'success' : 'info',
      )
      void queryClient.invalidateQueries({ queryKey: ['anonyms'] })
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error('Không xác định được hồ sơ cần xóa.')
      return anonymsApi.delete(deleteTarget.id)
    },
    onSuccess: () => {
      setDeleteTarget(null)
      pushToast('Đã xóa hồ sơ khách vãng lai.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['anonyms'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const openCreate = () => {
    setDetail(emptyDetail)
    setDetailError(null)
    setDetailOpen(true)
  }

  const openEdit = (customer: AnonymousCustomer) => {
    setDetail({ ...customer })
    setDetailError(null)
    setDetailOpen(true)
  }

  const closeDetail = () => {
    if (saveMutation.isPending) return
    setDetailOpen(false)
    setDetail(emptyDetail)
    setDetailError(null)
  }

  const submitDetail = (event: FormEvent) => {
    event.preventDefault()
    const validation = validateAnonymousDetail(detail)
    setDetailError(validation)
    if (!validation) saveMutation.mutate()
  }

  return (
    <section className="anonym-workspace">
      <PageHeader
        eyebrow="Quản trị"
        title="Khách vãng lai"
        description="Quản lý hồ sơ CCCD và gắn danh tính vào đúng phiên máy vãng lai đang online."
        actions={
          <Button type="button" variant="primary" onClick={openCreate}>
            Thêm khách
          </Button>
        }
      />

      <InlineAlert tone="info">
        Danh sách quản lý không suy đoán máy đang gắn. Khi gắn phiên, WebUI đọc snapshot
        Máy trạm và chỉ cho chọn máy vãng lai đang online có phiên hoạt động.
      </InlineAlert>

      <section className="anonym-toolbar" aria-label="Tìm khách vãng lai">
        <label className="ds-field">
          <span className="ds-field__label">Tên / CCCD / địa chỉ</span>
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Nhập thông tin cần tìm"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div>
          <strong>{customers.length} hồ sơ hiển thị</strong>
          <span>{customersQuery.data?.length ?? 0} hồ sơ trên máy chủ</span>
        </div>
      </section>

      <section className="anonym-panel" aria-label="Danh sách khách vãng lai">
        {customersQuery.isLoading ? (
          <StateView title="Đang tải hồ sơ…" />
        ) : customersQuery.isError ? (
          <StateView
            title="Không tải được hồ sơ"
            description={
              customersQuery.error instanceof Error
                ? customersQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void customersQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : customers.length === 0 ? (
          <StateView
            title={search ? 'Không tìm thấy hồ sơ phù hợp' : 'Chưa có khách vãng lai'}
            description={
              search
                ? 'Thử một phần tên, CCCD hoặc địa chỉ khác.'
                : 'Tạo hồ sơ đầu tiên để bắt đầu quản lý CCCD.'
            }
          />
        ) : (
          <div className="anonym-list">
            {customers.map((customer) => (
              <article className="anonym-card" key={customer.id}>
                <div className="anonym-card__identity">
                  <strong>{customer.name}</strong>
                  <span>CCCD {maskIdCard(customer.idCard)}</span>
                  <StatusBadge tone="neutral">Hồ sơ #{customer.id}</StatusBadge>
                </div>
                <div className="anonym-card__address">
                  <span>Địa chỉ</span>
                  <strong>{customer.address || 'Chưa cập nhật'}</strong>
                </div>
                <div className="anonym-card__actions">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setAssignTarget(customer)
                      setHostName('')
                    }}
                  >
                    Gắn vào máy
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openEdit(customer)}
                  >
                    Sửa
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleteTarget(customer)}
                  >
                    Xóa
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={detailOpen}
        title={detail.id ? 'Cập nhật khách vãng lai' : 'Thêm khách vãng lai'}
        description="CCCD phải duy nhất trong danh sách."
        size="sm"
        onClose={closeDetail}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={closeDetail}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              form="anonym-detail-form"
              variant="primary"
              loading={saveMutation.isPending}
            >
              Lưu hồ sơ
            </Button>
          </>
        }
      >
        <form
          id="anonym-detail-form"
          className="anonym-detail-form"
          onSubmit={submitDetail}
        >
          {detailError ? <InlineAlert tone="danger">{detailError}</InlineAlert> : null}
          <label className="ds-field">
            <span className="ds-field__label">Họ tên</span>
            <input
              className="ds-input"
              type="text"
              maxLength={255}
              value={detail.name}
              onChange={(event) =>
                setDetail((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Số CCCD</span>
            <input
              className="ds-input"
              type="text"
              inputMode="numeric"
              maxLength={255}
              value={detail.idCard}
              onChange={(event) =>
                setDetail((current) => ({ ...current, idCard: event.target.value }))
              }
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Địa chỉ</span>
            <textarea
              className="ds-input anonym-address-input"
              maxLength={255}
              value={detail.address}
              onChange={(event) =>
                setDetail((current) => ({ ...current, address: event.target.value }))
              }
            />
          </label>
        </form>
      </Dialog>

      <Dialog
        open={assignTarget !== null}
        title="Gắn CCCD vào phiên máy"
        description={
          assignTarget
            ? `${assignTarget.name} · CCCD ${maskIdCard(assignTarget.idCard)}`
            : undefined
        }
        size="sm"
        onClose={() => {
          if (!assignMutation.isPending) {
            setAssignTarget(null)
            setHostName('')
          }
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={assignMutation.isPending}
              onClick={() => {
                setAssignTarget(null)
                setHostName('')
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={assignMutation.isPending}
              disabled={!hostName}
              onClick={() => assignMutation.mutate()}
            >
              Xác nhận gắn
            </Button>
          </>
        }
      >
        <div className="anonym-assign-form">
          {workstationsQuery.isLoading ? (
            <StateView title="Đang tải máy vãng lai…" />
          ) : workstationsQuery.isError ? (
            <InlineAlert tone="danger">
              Không tải được snapshot máy trạm; chưa thể gắn phiên an toàn.
            </InlineAlert>
          ) : eligibleMachines.length === 0 ? (
            <StateView
              title="Không có máy vãng lai phù hợp"
              description="Máy phải đang kết nối và có phiên khách vãng lai hoạt động."
            />
          ) : (
            <label className="ds-field">
              <span className="ds-field__label">Máy đang online</span>
              <Select
                className="ds-select"
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
              >
                <option value="">Chọn máy</option>
                {eligibleMachines.map((machine) => (
                  <option value={machine.hostName} key={machine.hostName}>
                    {machine.hostName} · {machine.userName || 'Khách vãng lai'}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <InlineAlert tone="warning">
            Nếu máy đã gắn một CCCD khác, máy chủ sẽ đóng liên kết cũ rồi gắn hồ sơ
            này. Hồ sơ đang dùng ở máy khác sẽ bị từ chối.
          </InlineAlert>
        </div>
      </Dialog>

      <ConfirmAction
        open={deleteTarget !== null}
        title="Xóa hồ sơ khách vãng lai"
        description={
          deleteTarget
            ? `${deleteTarget.name} · CCCD ${maskIdCard(deleteTarget.idCard)}`
            : undefined
        }
        confirmLabel="Xác nhận xóa"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Thao tác xóa hồ sơ khỏi danh sách quản lý. Hãy chắc chắn khách không còn sử
          dụng phiên máy trước khi tiếp tục.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
