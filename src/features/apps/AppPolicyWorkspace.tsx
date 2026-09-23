import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  appsApi,
  type AppEntry,
  type AppListType,
  type AppWriteBody,
} from '../../api/apps'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  PageHeader,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  APP_SOURCE_SYSTEM,
  APP_SOURCE_USER,
  canMutateApp,
  decodeRestrictType,
  encodeRestrictType,
  findCrossListConflict,
  matchesApp,
  validateAppDraft,
  type RestrictMode,
} from './appModel'
import './apps.css'

const RIGHT_ADD_APP = 71
const RIGHT_MODIFY_APP = 72
const RIGHT_DELETE_APP = 73

type Draft = {
  name: string
  description: string
  mode: RestrictMode
  applyToAvailable: boolean
  hash: string
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  mode: 'name',
  applyToAvailable: false,
  hash: '',
}

function typeLabel(type: AppListType) {
  return type === 'restrict' ? 'Danh sách hạn chế' : 'Danh sách cho phép'
}

export function AppPolicyWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const [activeType, setActiveType] = useState<AppListType>('restrict')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AppEntry | null>(null)
  const [deleting, setDeleting] = useState<AppEntry | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const allowQuery = useQuery({
    queryKey: ['apps', 'allow'],
    queryFn: () => appsApi.getList('allow'),
  })
  const restrictQuery = useQuery({
    queryKey: ['apps', 'restrict'],
    queryFn: () => appsApi.getList('restrict'),
  })

  const lists: Record<AppListType, AppEntry[]> = {
    allow: allowQuery.data ?? [],
    restrict: restrictQuery.data ?? [],
  }
  const activeQuery = activeType === 'allow' ? allowQuery : restrictQuery
  const entries = lists[activeType].filter((entry) => matchesApp(entry, search))
  const canAdd = hasRight(RIGHT_ADD_APP)
  const canEdit = hasRight(RIGHT_MODIFY_APP)
  const canDelete = hasRight(RIGHT_DELETE_APP)

  const saveMutation = useMutation({
    mutationFn: ({
      type,
      id,
      body,
    }: {
      type: AppListType
      id?: number
      body: AppWriteBody
    }) => {
      if (id === undefined) {
        return appsApi.addApp(type, body).then(() => undefined)
      }
      return appsApi.updateApp(type, id, body)
    },
    onSuccess: (_, variables) => {
      setCreateOpen(false)
      setEditing(null)
      setDraft(EMPTY_DRAFT)
      pushToast(
        variables.id === undefined
          ? `Đã thêm ứng dụng vào ${typeLabel(variables.type).toLocaleLowerCase('vi')}.`
          : 'Đã cập nhật chính sách ứng dụng.',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['apps'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: ({
      type,
      entry,
    }: {
      type: AppListType
      entry: AppEntry
    }) => appsApi.deleteApp(type, entry.id),
    onSuccess: () => {
      setDeleting(null)
      pushToast('Đã xóa chính sách ứng dụng.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['apps'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const openCreate = () => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setCreateOpen(true)
  }

  const openEdit = (entry: AppEntry) => {
    const restriction = decodeRestrictType(entry.restrictType)
    setCreateOpen(false)
    setEditing(entry)
    setDraft({
      name: entry.name,
      description: entry.description,
      mode: restriction.mode,
      applyToAvailable: restriction.applyToAvailable,
      hash: entry.hash,
    })
  }

  const submitSave = () => {
    const validationError = validateAppDraft({
      type: activeType,
      ...draft,
    })
    if (validationError) {
      pushToast(validationError, 'error')
      return
    }

    const conflict = findCrossListConflict(draft.name, activeType, lists)
    if (conflict) {
      pushToast(
        `"${conflict.name}" đã nằm trong ${
          activeType === 'allow' ? 'danh sách hạn chế' : 'danh sách cho phép'
        }. Hai chính sách không thể cùng áp dụng.`,
        'error',
      )
      return
    }

    const body: AppWriteBody = {
      name: draft.name.trim(),
      description: draft.description.trim(),
    }
    if (activeType === 'restrict') {
      body.restrictType = encodeRestrictType(
        draft.mode,
        draft.applyToAvailable,
      )
      body.hash = draft.mode === 'hash' ? draft.hash.trim().toLowerCase() : ''
    }
    saveMutation.mutate({
      type: activeType,
      id: editing?.id,
      body,
    })
  }

  const refresh = () => {
    void Promise.all([allowQuery.refetch(), restrictQuery.refetch()])
  }

  return (
    <section className="app-policy-workspace">
      <PageHeader
        eyebrow="Quản trị máy trạm"
        title="Chính sách ứng dụng"
        description="Quản lý ứng dụng bị hạn chế hoặc được cho phép theo chính sách máy trạm."
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              loading={allowQuery.isFetching || restrictQuery.isFetching}
              onClick={refresh}
            >
              Làm mới
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canAdd}
              title={canAdd ? undefined : 'Cần quyền Thêm ứng dụng (71).'}
              onClick={openCreate}
            >
              Thêm ứng dụng
            </Button>
          </>
        }
      />

      <nav className="app-policy-tabs" role="tablist" aria-label="Loại chính sách ứng dụng">
        <button
          type="button"
          role="tab"
          aria-selected={activeType === 'restrict'}
          className={activeType === 'restrict' ? 'is-active' : ''}
          onClick={() => setActiveType('restrict')}
        >
          Hạn chế ({lists.restrict.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeType === 'allow'}
          className={activeType === 'allow' ? 'is-active' : ''}
          onClick={() => setActiveType('allow')}
        >
          Cho phép ({lists.allow.length})
        </button>
      </nav>

      <section className="app-policy-toolbar">
        <label className="ds-field">
          <span className="ds-field__label">Tìm ứng dụng</span>
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Tên, mô tả hoặc MD5…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div>
          <span>Quyền của phiên hiện tại</span>
          <div>
            <StatusBadge tone={canAdd ? 'success' : 'neutral'}>Thêm</StatusBadge>
            <StatusBadge tone={canEdit ? 'success' : 'neutral'}>Sửa</StatusBadge>
            <StatusBadge tone={canDelete ? 'success' : 'neutral'}>Xóa</StatusBadge>
          </div>
        </div>
      </section>

      <section className="app-policy-panel" aria-label={typeLabel(activeType)}>
        <header>
          <div>
            <strong>{typeLabel(activeType)}</strong>
            <span>
              {entries.length === lists[activeType].length
                ? `${entries.length} ứng dụng`
                : `${entries.length}/${lists[activeType].length} ứng dụng phù hợp`}
            </span>
          </div>
          <StatusBadge tone={activeType === 'restrict' ? 'danger' : 'success'}>
            {activeType === 'restrict' ? 'Chặn chạy' : 'Được phép chạy'}
          </StatusBadge>
        </header>

        {activeQuery.isLoading ? (
          <StateView title="Đang tải chính sách ứng dụng…" />
        ) : activeQuery.isError ? (
          <StateView
            title="Không tải được chính sách"
            description={
              activeQuery.error instanceof Error
                ? activeQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void activeQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : entries.length === 0 ? (
          <StateView
            title={search.trim() ? 'Không có ứng dụng phù hợp' : 'Danh sách đang trống'}
            description={
              search.trim()
                ? 'Thử từ khóa khác.'
                : `Chưa có ứng dụng trong ${typeLabel(activeType).toLocaleLowerCase('vi')}.`
            }
          />
        ) : (
          <div className="app-policy-table-wrap">
            <table className="app-policy-table">
              <thead>
                <tr>
                  <th>Ứng dụng</th>
                  {activeType === 'restrict' ? <th>Cách nhận diện</th> : null}
                  <th>Mô tả</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const restriction = decodeRestrictType(entry.restrictType)
                  return (
                    <tr
                      key={entry.id}
                      className={
                        entry.addedBy === APP_SOURCE_SYSTEM
                          ? 'is-system-policy'
                          : undefined
                      }
                    >
                      <td>
                        <strong>{entry.name}</strong>
                        <span>#{entry.id}</span>
                        <StatusBadge
                          tone={
                            entry.addedBy === APP_SOURCE_SYSTEM
                              ? 'info'
                              : entry.addedBy === APP_SOURCE_USER
                                ? 'neutral'
                                : 'warning'
                          }
                        >
                          {entry.addedBy === APP_SOURCE_SYSTEM
                            ? 'Nguồn CSM'
                            : entry.addedBy === APP_SOURCE_USER
                              ? 'Tại quán'
                              : 'Nguồn chưa xác định'}
                        </StatusBadge>
                      </td>
                      {activeType === 'restrict' ? (
                        <td>
                          <StatusBadge
                            tone={restriction.mode === 'hash' ? 'warning' : 'neutral'}
                          >
                            {restriction.mode === 'hash' ? 'Theo nội dung' : 'Theo tên'}
                          </StatusBadge>
                          {restriction.applyToAvailable ? (
                            <StatusBadge tone="info">Cả máy rảnh</StatusBadge>
                          ) : null}
                          {restriction.mode === 'hash' && entry.hash ? (
                            <code title={entry.hash}>{entry.hash}</code>
                          ) : null}
                        </td>
                      ) : null}
                      <td>{entry.description || '—'}</td>
                      <td>
                        <div className="app-policy-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!canEdit || !canMutateApp(entry)}
                            title={
                              !canEdit
                                ? 'Cần quyền Sửa ứng dụng (72).'
                                : !canMutateApp(entry)
                                  ? 'Chính sách không thuộc nguồn tại quán được giữ chỉ đọc.'
                                  : undefined
                            }
                            onClick={() => openEdit(entry)}
                          >
                            Sửa
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!canDelete || !canMutateApp(entry)}
                            title={
                              !canDelete
                                ? 'Cần quyền Xóa ứng dụng (73).'
                                : !canMutateApp(entry)
                                  ? 'Chính sách không thuộc nguồn tại quán được giữ chỉ đọc.'
                                  : undefined
                            }
                            onClick={() => setDeleting(entry)}
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
        open={createOpen || Boolean(editing)}
        title={
          editing
            ? `Sửa ${editing.name}`
            : `Thêm vào ${typeLabel(activeType).toLocaleLowerCase('vi')}`
        }
        description={
          activeType === 'restrict'
            ? 'Chọn cách máy trạm nhận diện ứng dụng bị hạn chế.'
            : 'Tên nên là tên tệp thực thi, ví dụ game.exe.'
        }
        size="md"
        onClose={
          saveMutation.isPending
            ? () => undefined
            : () => {
                setCreateOpen(false)
                setEditing(null)
              }
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={() => {
                setCreateOpen(false)
                setEditing(null)
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saveMutation.isPending}
              onClick={submitSave}
            >
              {editing ? 'Lưu thay đổi' : 'Thêm ứng dụng'}
            </Button>
          </>
        }
      >
        <div className="app-policy-form">
          {activeType === 'restrict' ? (
            <fieldset>
              <legend>Cách nhận diện</legend>
              <label>
                <input
                  type="radio"
                  name="restrict-mode"
                  checked={draft.mode === 'name'}
                  onChange={() => setDraft((current) => ({ ...current, mode: 'name', hash: '' }))}
                />
                <span>
                  <strong>Theo tên tệp</strong>
                  <small>Phù hợp khi tên tệp thực thi là ổn định.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="restrict-mode"
                  checked={draft.mode === 'hash'}
                  onChange={() => setDraft((current) => ({ ...current, mode: 'hash' }))}
                />
                <span>
                  <strong>Theo nội dung</strong>
                  <small>Chính xác theo nội dung tệp, cần giá trị MD5 32 ký tự.</small>
                </span>
              </label>
            </fieldset>
          ) : null}

          <label className="ds-field">
            <span className="ds-field__label">Tên ứng dụng</span>
            <input
              className="ds-input"
              value={draft.name}
              maxLength={100}
              autoFocus
              placeholder="Ví dụ: game.exe"
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
            <small>{draft.name.length}/100 ký tự</small>
          </label>

          {activeType === 'restrict' && draft.mode === 'hash' ? (
            <label className="ds-field">
              <span className="ds-field__label">MD5 của tệp thực thi</span>
              <input
                className="ds-input app-policy-hash-input"
                value={draft.hash}
                maxLength={32}
                spellCheck={false}
                placeholder="32 ký tự hệ 16"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, hash: event.target.value }))
                }
              />
              <small>
                MFC có thể đọc tệp trên máy chủ để tính MD5. Trình duyệt chưa có
                endpoint hash/upload nên WebUI nhận MD5 đã được xác minh.
              </small>
            </label>
          ) : null}

          <label className="ds-field">
            <span className="ds-field__label">Mô tả</span>
            <textarea
              className="ds-textarea"
              rows={3}
              value={draft.description}
              maxLength={200}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <small>{draft.description.length}/200 ký tự</small>
          </label>

          {activeType === 'restrict' ? (
            <label className="app-policy-checkbox">
              <input
                type="checkbox"
                checked={draft.applyToAvailable}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    applyToAvailable: event.target.checked,
                  }))
                }
              />
              <span>
                <strong>Áp dụng cả máy đang rảnh</strong>
                <small>
                  Giữ đúng tùy chọn “Available workstation” của form MFC.
                </small>
              </span>
            </label>
          ) : null}
        </div>
      </Dialog>

      <ConfirmAction
        open={Boolean(deleting)}
        title="Xóa chính sách ứng dụng?"
        description={deleting ? `${deleting.name} · #${deleting.id}` : undefined}
        confirmLabel="Xóa ứng dụng"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            deleteMutation.mutate({ type: activeType, entry: deleting })
          }
        }}
      >
        <InlineAlert tone="danger">
          Ứng dụng sẽ bị xóa khỏi {typeLabel(activeType).toLocaleLowerCase('vi')}.
          Thao tác này có hiệu lực với chính sách máy trạm sử dụng danh sách đó.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
