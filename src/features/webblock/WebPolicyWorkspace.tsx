import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acceptWebBlock,
  createWebBlock,
  deleteWebBlock,
  getWebBlocks,
  updateWebBlock,
  type WebBlockItem,
  type WebBlockWriteBody,
} from '../../api/webblock'
import { API_BASE_URL } from '../../api/client'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  ListPagination,
  PageHeader,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  canMutateWebBlock,
  MASTER_SOURCE,
  validateWebBlock,
} from './webBlockModel'
import './webblock.css'

const PAGE_SIZE = 50
const RIGHT_WEB_ADD = 81
const RIGHT_WEB_EDIT = 82
const RIGHT_WEB_DELETE = 83

const EMPTY_DRAFT: WebBlockWriteBody = {
  url: '',
  title: '',
  description: '',
  active: true,
}

function apiHost() {
  try {
    return new URL(API_BASE_URL, window.location.origin).hostname
  } catch {
    return window.location.hostname
  }
}

export function WebPolicyWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const [page, setPage] = useState(0)
  const [urlInput, setUrlInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [filters, setFilters] = useState({ url: '', title: '' })
  const [draft, setDraft] = useState<WebBlockWriteBody>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<WebBlockItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<WebBlockItem | null>(null)
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [pendingApply, setPendingApply] = useState(false)

  const listQuery = useQuery({
    queryKey: ['webblock', page, filters.url, filters.title],
    queryFn: () =>
      getWebBlocks({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        url: filters.url || undefined,
        title: filters.title || undefined,
      }),
  })

  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const localCount = items.filter((item) => canMutateWebBlock(item)).length
  const masterCount = items.length - localCount
  const canAdd = hasRight(RIGHT_WEB_ADD)
  const canEdit = hasRight(RIGHT_WEB_EDIT)
  const canDelete = hasRight(RIGHT_WEB_DELETE)

  const markChanged = () => {
    setPendingApply(true)
    void queryClient.invalidateQueries({ queryKey: ['webblock'] })
  }

  const saveMutation = useMutation({
    mutationFn: async (body: WebBlockWriteBody) => {
      if (editing) {
        await updateWebBlock(editing.id, body)
      } else {
        await createWebBlock(body)
      }
    },
    onSuccess: () => {
      pushToast(editing ? 'Đã cập nhật website.' : 'Đã thêm website.', 'success')
      setFormOpen(false)
      setEditing(null)
      setDraft(EMPTY_DRAFT)
      markChanged()
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (item: WebBlockItem) => deleteWebBlock(item.id),
    onSuccess: () => {
      pushToast('Đã xóa website khỏi danh sách.', 'success')
      setDeleting(null)
      markChanged()
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const acceptMutation = useMutation({
    mutationFn: acceptWebBlock,
    onSuccess: () => {
      setApplyConfirmOpen(false)
      setPendingApply(false)
      pushToast('Đã xuất và gửi danh sách chặn tới các máy đang online.', 'success')
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setFormOpen(true)
  }

  const openEdit = (item: WebBlockItem) => {
    if (!canMutateWebBlock(item)) {
      pushToast('Bản ghi nguồn trung tâm chỉ được xem trong WebUI.', 'info')
      return
    }
    setEditing(item)
    setDraft({
      url: item.url,
      title: item.title,
      description: item.description,
      active: item.active,
    })
    setFormOpen(true)
  }

  const submit = () => {
    const normalized: WebBlockWriteBody = {
      url: draft.url.trim(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      active: draft.active,
    }
    const error = validateWebBlock(normalized, [
      window.location.hostname,
      apiHost(),
      '168atoz.com',
    ])
    if (error) {
      pushToast(error, 'error')
      return
    }
    saveMutation.mutate(normalized)
  }

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    setPage(0)
    setFilters({ url: urlInput.trim(), title: titleInput.trim() })
  }

  const clearFilters = () => {
    setUrlInput('')
    setTitleInput('')
    setFilters({ url: '', title: '' })
    setPage(0)
  }

  return (
    <section className="web-policy-workspace">
      <PageHeader
        eyebrow="Quản trị máy trạm"
        title="Khống chế website"
        description="Quản lý địa chỉ bị chặn và chủ động phát hành danh sách mới xuống máy trạm."
        actions={
          <>
            <Button
              type="button"
              variant={pendingApply ? 'primary' : 'secondary'}
              disabled={!isAdmin}
              title={
                isAdmin
                  ? undefined
                  : 'Chỉ ADMIN được xuất và gửi danh sách tới toàn bộ máy trạm.'
              }
              onClick={() => setApplyConfirmOpen(true)}
            >
              {pendingApply ? 'Áp dụng thay đổi' : 'Áp dụng tới máy trạm'}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canAdd}
              title={canAdd ? undefined : 'Cần quyền Thêm website (81).'}
              onClick={openCreate}
            >
              Thêm website
            </Button>
          </>
        }
      />

      <InlineAlert tone={pendingApply ? 'warning' : 'info'}>
        {pendingApply ? (
          <>
            Thay đổi đã lưu và file chia sẻ đang được tạo lại, nhưng máy trạm chưa
            nhận cấu hình mới. ADMIN cần bấm <strong>Áp dụng thay đổi</strong>.
          </>
        ) : (
          <>
            Lưu dữ liệu và phát hành xuống máy trạm là hai bước riêng, giữ đúng nút
            “Chấp nhận” của MFC. Máy chủ bảo vệ whitelist vận hành trên mọi lần
            thêm/sửa; bản ghi nguồn trung tâm được hiển thị chỉ đọc.
          </>
        )}
      </InlineAlert>

      <form className="web-policy-filters" onSubmit={applyFilters}>
        <label className="ds-field">
          <span className="ds-field__label">Địa chỉ website</span>
          <input
            className="ds-input"
            type="search"
            value={urlInput}
            maxLength={200}
            placeholder="Ví dụ: facebook.com"
            onChange={(event) => setUrlInput(event.target.value)}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Tên website</span>
          <input
            className="ds-input"
            type="search"
            value={titleInput}
            maxLength={250}
            placeholder="Ví dụ: Mạng xã hội"
            onChange={(event) => setTitleInput(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">
          Tìm
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!filters.url && !filters.title && !urlInput && !titleInput}
          onClick={clearFilters}
        >
          Xóa lọc
        </Button>
      </form>

      <section className="web-policy-panel">
        <header>
          <div>
            <strong>{new Intl.NumberFormat('vi-VN').format(total)} website</strong>
            <span>
              Trang này: {localCount} do quán quản lý
              {masterCount ? ` · ${masterCount} từ nguồn trung tâm` : ''}
            </span>
          </div>
          <div>
            <Button
              type="button"
              variant="ghost"
              loading={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              Làm mới
            </Button>
            <span>
              Trang {page + 1}/{totalPages}
            </span>
          </div>
        </header>

        <ListPagination
          page={page}
          totalPages={totalPages}
          canNext={page < totalPages - 1}
          onPrevious={() => setPage((current) => Math.max(0, current - 1))}
          onNext={() => setPage((current) => current + 1)}
        />

        {listQuery.isLoading ? (
          <StateView title="Đang tải danh sách website…" />
        ) : listQuery.isError ? (
          <StateView
            title="Không tải được danh sách website"
            description={
              listQuery.error instanceof Error
                ? listQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void listQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <StateView
            title={filters.url || filters.title ? 'Không có website phù hợp' : 'Danh sách đang trống'}
            description={
              filters.url || filters.title
                ? 'Thử địa chỉ hoặc tên website khác.'
                : 'Thêm website đầu tiên để bắt đầu chính sách.'
            }
          />
        ) : (
          <div className="web-policy-table-wrap">
            <table className="web-policy-table">
              <thead>
                <tr>
                  <th>Website</th>
                  <th>Trạng thái</th>
                  <th>Nguồn</th>
                  <th>Mô tả</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const mutable = canMutateWebBlock(item)
                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title || 'Chưa đặt tên'}</strong>
                        <span>{item.url}</span>
                      </td>
                      <td>
                        <StatusBadge tone={item.active ? 'danger' : 'neutral'}>
                          {item.active ? 'Đang chặn' : 'Tạm tắt'}
                        </StatusBadge>
                      </td>
                      <td>
                        <StatusBadge tone={mutable ? 'info' : 'neutral'}>
                          {item.addedBy === MASTER_SOURCE ? 'Trung tâm' : 'Tại quán'}
                        </StatusBadge>
                      </td>
                      <td>{item.description || '—'}</td>
                      <td>
                        <div className="web-policy-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!mutable || !canEdit}
                            title={
                              !mutable
                                ? 'Bản ghi nguồn trung tâm chỉ được xem.'
                                : canEdit
                                  ? undefined
                                  : 'Cần quyền Sửa website (82).'
                            }
                            onClick={() => openEdit(item)}
                          >
                            Sửa
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!mutable || !canDelete}
                            title={
                              !mutable
                                ? 'Bản ghi nguồn trung tâm chỉ được xem.'
                                : canDelete
                                  ? undefined
                                  : 'Cần quyền Xóa website (83).'
                            }
                            onClick={() => setDeleting(item)}
                          >
                            Xóa
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </section>

      <Dialog
        open={formOpen}
        title={editing ? 'Sửa website khống chế' : 'Thêm website khống chế'}
        description="Địa chỉ là bắt buộc; tên và mô tả giúp nhân viên nhận diện chính sách."
        size="md"
        onClose={saveMutation.isPending ? () => undefined : () => setFormOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={() => setFormOpen(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saveMutation.isPending}
              onClick={submit}
            >
              {editing ? 'Lưu thay đổi' : 'Thêm website'}
            </Button>
          </>
        }
      >
        <div className="web-policy-form">
          <label className="ds-field">
            <span className="ds-field__label">Địa chỉ website</span>
            <input
              className="ds-input"
              value={draft.url}
              maxLength={250}
              autoFocus
              placeholder="facebook.com"
              onChange={(event) =>
                setDraft((current) => ({ ...current, url: event.target.value }))
              }
            />
            <small>{draft.url.length}/250 ký tự</small>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Tên website</span>
            <input
              className="ds-input"
              value={draft.title}
              maxLength={250}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
            <small>{draft.title.length}/250 ký tự</small>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Mô tả</span>
            <textarea
              className="ds-textarea"
              rows={3}
              value={draft.description}
              maxLength={250}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <small>{draft.description.length}/250 ký tự</small>
          </label>
          <label className="web-policy-checkbox">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            <span>
              <strong>Khống chế website này</strong>
              <small>Tắt để giữ bản ghi nhưng chưa đưa vào danh sách chặn.</small>
            </span>
          </label>
          <InlineAlert tone="warning">
            Máy chủ là nguồn kết luận cho whitelist vận hành và sẽ từ chối website
            được bảo vệ. WebUI chỉ kiểm tra sớm domain máy chủ hiện tại và 168atoz
            để tránh thao tác sai trước khi gửi.
          </InlineAlert>
        </div>
      </Dialog>

      <ConfirmAction
        open={Boolean(deleting)}
        title="Xóa website khỏi danh sách?"
        description={deleting ? `${deleting.title || 'Website'} · ${deleting.url}` : undefined}
        confirmLabel="Xóa website"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
      >
        Sau khi xóa, ADMIN vẫn cần áp dụng để phát hành danh sách mới xuống máy trạm.
      </ConfirmAction>

      <ConfirmAction
        open={applyConfirmOpen}
        title="Áp dụng danh sách tới máy trạm?"
        description="Máy chủ sẽ xuất file chặn mới và gửi thông tin file tới toàn bộ máy đang online."
        confirmLabel="Xuất và gửi"
        pending={acceptMutation.isPending}
        onCancel={() => setApplyConfirmOpen(false)}
        onConfirm={() => acceptMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Đây là thao tác toàn phòng máy. Các máy đang offline chỉ nhận cấu hình theo
          cơ chế đồng bộ khi kết nối lại.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
