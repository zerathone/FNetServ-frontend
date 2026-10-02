import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Broom } from '@phosphor-icons/react'
import { usersApi, type CleanCandidate } from '../../api/users'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  ListPagination,
  Select,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  CLEAN_PAGE_SIZE,
  buildCleanQuery,
  defaultCleanForm,
  describeDeleteError,
  describeFilterError,
  isRbacDenied,
  summarizeDeleteResult,
  sumRemainMoney,
  validateCleanForm,
  type CleanDebitMode,
  type CleanForm,
  type FormErrors,
  type SortChoice,
} from './userAdminModel'

const DEBIT_OPTIONS: Array<{ value: CleanDebitMode; label: string }> = [
  { value: 'no', label: 'Không nợ' },
  { value: 'have', label: 'Có nợ' },
  { value: 'all', label: 'Tất cả' },
]

const SORT_OPTIONS: Array<{ value: SortChoice; label: string }> = [
  { value: 'none', label: 'Không sắp xếp' },
  { value: 'asc', label: 'Tăng dần' },
  { value: 'desc', label: 'Giảm dần' },
]

const nf = new Intl.NumberFormat('vi-VN')
const money = (value: number) => `${nf.format(value)} đ`

function displayDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso || '—'
}

type PendingDelete = { ids: number[]; count: number; remain: number }

/**
 * "Dọn dẹp hội viên" (CUserPage -> CCleanMemberDlg + CCleanMemberList). Xóa MỀM theo ô tick của
 * trang đang xem; không có "xóa tất cả theo bộ lọc" (user chốt 2026-10-02). Quyền 23 do nơi gọi
 * kiểm trước khi mount. Mount mới mỗi lần mở -> trạng thái sạch; cache dọn khi đóng.
 */
export function UserCleanupDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CleanForm>(() => defaultCleanForm())
  const [errors, setErrors] = useState<FormErrors<CleanForm>>({})
  // Bộ lọc ĐÃ bấm "Tìm" — bảng + trang bám theo cái này, không theo giá trị đang gõ dở.
  const [applied, setApplied] = useState<CleanForm | null>(null)
  const [page, setPage] = useState(0)
  const [selection, setSelection] = useState<{ stamp: number; ids: number[] }>({ stamp: 0, ids: [] })
  const [pending, setPending] = useState<PendingDelete | null>(null)

  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: ['users-clean'] })
    },
    [queryClient],
  )

  const appliedKey = applied ? buildCleanQuery(applied, 0) : ''
  const query = useQuery({
    queryKey: ['users-clean', appliedKey, page],
    queryFn: () => usersApi.getCleanCandidates(applied as CleanForm, page),
    enabled: applied !== null,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  })

  const items: CleanCandidate[] = query.data?.items ?? []
  const total = query.data?.total ?? 0
  // Lựa chọn gắn với đúng lần dữ liệu đã tải: refetch/đổi trang/đổi bộ lọc -> tự rỗng (parity MFC).
  const selectedIds = selection.stamp === query.dataUpdatedAt ? selection.ids : []
  const selectedSet = new Set(selectedIds)
  const allSelected = items.length > 0 && selectedIds.length === items.length
  const setSelected = (ids: number[]) => setSelection({ stamp: query.dataUpdatedAt, ids })

  const update = <K extends keyof CleanForm>(key: K, value: CleanForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submitSearch = () => {
    const found = validateCleanForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const next = { ...form }
    if (applied && buildCleanQuery(next, 0) === appliedKey && page === 0) {
      void query.refetch()
    }
    setApplied(next)
    setPage(0)
  }

  const invalidateLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['users-clean'] })
    void queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    void queryClient.invalidateQueries({ queryKey: ['users-adv'] })
  }

  const previewMutation = useMutation({
    mutationFn: (ids: number[]) => usersApi.deleteBatch(ids, false),
    onSuccess: (result, ids) => {
      if (result.deleted || !('count' in result)) {
        pushToast('Phản hồi xem trước không hợp lệ, chưa xóa gì.', 'error')
        return
      }
      const chosen = items.filter((item) => ids.includes(item.userId))
      setPending({ ids, count: result.count, remain: sumRemainMoney(chosen) })
    },
    onError: (error) => {
      if (!isRbacDenied(error)) pushToast(describeDeleteError(error), 'error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) => usersApi.deleteBatch(ids, true),
    onSuccess: (result, ids) => {
      const outcome = summarizeDeleteResult(ids.length, result)
      pushToast(outcome.message, outcome.tone)
      setPending(null)
      // Xóa hết trang cuối -> lùi 1 trang (đổi key tự tải), không thì làm mới trang hiện tại.
      if (ids.length >= items.length && page > 0) setPage(page - 1)
      invalidateLists()
    },
    onError: (error) => {
      setPending(null)
      if (!isRbacDenied(error)) pushToast(describeDeleteError(error), 'error')
    },
  })

  const debitMode = applied?.debit ?? form.debit
  const deleteBlocked = debitMode === 'have'
  const totalPages = Math.max(1, Math.ceil(total / CLEAN_PAGE_SIZE))

  return (
    <Dialog
      open
      size="lg"
      title="Dọn dẹp hội viên"
      description="Lọc hội viên lâu không hoạt động rồi tick để xóa. Tài khoản bị vô hiệu hóa, lịch sử giao dịch vẫn được giữ."
      // Esc ở hộp xác nhận cũng bắn tới Dialog này (cùng listener document) — không đóng khi đang xác nhận/xóa.
      onClose={pending !== null || deleteMutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button
            type="button"
            variant="danger"
            icon={<Broom size={18} weight="bold" aria-hidden="true" />}
            loading={previewMutation.isPending}
            disabled={selectedIds.length === 0 || deleteBlocked || deleteMutation.isPending}
            onClick={() => previewMutation.mutate(selectedIds)}
          >
            Xóa (đã tick){selectedIds.length > 0 ? ` · ${selectedIds.length}` : ''}
          </Button>
        </>
      }
    >
      <div className="user-admin">
        <form
          className="user-admin__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submitSearch()
          }}
        >
          <div className="user-admin__row">
            <label className="user-admin__check">
              <input
                type="checkbox"
                checked={form.useLastLogin}
                onChange={(event) => update('useLastLogin', event.target.checked)}
              />
              <span>Đăng nhập cuối trước ngày</span>
            </label>
            <div className="ds-field">
              <input
                className="ds-input"
                type="date"
                aria-label="Ngày đăng nhập cuối"
                value={form.lastLogin}
                disabled={!form.useLastLogin}
                aria-invalid={errors.lastLogin ? true : undefined}
                onChange={(event) => update('lastLogin', event.target.value)}
              />
              {errors.lastLogin ? <span className="ds-field__error" role="alert">{errors.lastLogin}</span> : null}
            </div>
            <Select
              aria-label="Sắp xếp theo đăng nhập cuối"
              value={form.sortLastLogin}
              onChange={(event) => update('sortLastLogin', event.target.value as SortChoice)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>

          <div className="user-admin__row">
            <label className="user-admin__check">
              <input
                type="checkbox"
                checked={form.useMaxRemain}
                onChange={(event) => update('useMaxRemain', event.target.checked)}
              />
              <span>Số dư tối đa (đ)</span>
            </label>
            <div className="ds-field">
              <input
                className="ds-input"
                inputMode="numeric"
                aria-label="Số dư tối đa"
                value={form.maxRemain}
                disabled={!form.useMaxRemain}
                aria-invalid={errors.maxRemain ? true : undefined}
                onChange={(event) => update('maxRemain', event.target.value.trim())}
              />
              {errors.maxRemain ? <span className="ds-field__error" role="alert">{errors.maxRemain}</span> : null}
            </div>
            <Select
              aria-label="Sắp xếp theo số dư"
              value={form.sortRemain}
              onChange={(event) => update('sortRemain', event.target.value as SortChoice)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>

          <fieldset className="user-admin__row user-admin__radios">
            <legend>Công nợ</legend>
            {DEBIT_OPTIONS.map((option) => (
              <label key={option.value} className="user-admin__check">
                <input
                  type="radio"
                  name="clean-debit"
                  checked={form.debit === option.value}
                  onChange={() => update('debit', option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
            <Button type="submit" variant="secondary" loading={query.isFetching} className="user-admin__submit">
              Tìm
            </Button>
          </fieldset>
        </form>

        {debitMode === 'have' ? (
          <InlineAlert tone="warning">
            Hội viên còn nợ không thể xóa (máy chủ chặn cả lô). Chế độ này chỉ để xem danh sách.
          </InlineAlert>
        ) : debitMode === 'all' ? (
          <InlineAlert tone="warning">
            Nếu trong số đã tick có tài khoản còn nợ, máy chủ sẽ từ chối xóa cả lô.
          </InlineAlert>
        ) : null}

        {applied === null ? (
          <p className="user-admin__empty">Chọn điều kiện rồi bấm “Tìm” để xem danh sách.</p>
        ) : query.isError && !query.data ? (
          <InlineAlert tone="danger">
            {isRbacDenied(query.error)
              ? 'Bạn không có quyền dọn dẹp hội viên.'
              : describeFilterError(query.error)}
          </InlineAlert>
        ) : (
          <>
            <div className="user-admin__summary">
              <span>
                Tìm thấy <strong>{nf.format(total)}</strong> hội viên
                {query.isFetching ? ' · đang tải…' : ''}
              </span>
              <ListPagination
                page={page}
                totalPages={totalPages}
                canNext={(page + 1) * CLEAN_PAGE_SIZE < total}
                onPrevious={() => setPage((current) => Math.max(0, current - 1))}
                onNext={() => setPage((current) => current + 1)}
              />
            </div>
            <div className="user-admin__table-scroll">
              <table className="user-admin__table">
                <thead>
                  <tr>
                    <th className="user-admin__tick">
                      <input
                        type="checkbox"
                        aria-label="Chọn cả trang"
                        checked={allSelected}
                        disabled={items.length === 0}
                        onChange={(event) =>
                          setSelected(event.target.checked ? items.map((item) => item.userId) : [])
                        }
                      />
                    </th>
                    <th>ID</th>
                    <th>Tên đăng nhập</th>
                    <th className="is-money">Số dư</th>
                    <th className="is-money">Tổng nợ</th>
                    <th>Nhóm giá</th>
                    <th>Đăng nhập cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="user-admin__empty">
                        {query.isFetching ? 'Đang tải…' : 'Không có hội viên nào khớp điều kiện.'}
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.userId}>
                        <td className="user-admin__tick">
                          <input
                            type="checkbox"
                            aria-label={`Chọn ${item.username}`}
                            checked={selectedSet.has(item.userId)}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? [...selectedIds, item.userId]
                                  : selectedIds.filter((id) => id !== item.userId),
                              )
                            }
                          />
                        </td>
                        <td>{item.userId}</td>
                        <td><strong>{item.username}</strong></td>
                        <td className="is-money">{money(item.remainMoney)}</td>
                        <td className="is-money">{money(item.totalDebit)}</td>
                        <td>{item.priceType || '—'}</td>
                        <td>{displayDate(item.lastLoginDate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="user-admin__hint">
              Chỉ xóa được các dòng đã tick ở trang này; đổi trang hoặc tải lại sẽ bỏ chọn.
            </p>
          </>
        )}
      </div>

      <ConfirmAction
        open={pending !== null}
        title="Xóa hội viên đã chọn?"
        description={pending ? `${pending.count} tài khoản` : undefined}
        confirmLabel="Xóa tài khoản"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && deleteMutation.mutate(pending.ids)}
      >
        <InlineAlert tone="warning">
          Tài khoản sẽ bị vô hiệu hóa và không đăng nhập lại được; lịch sử giao dịch vẫn được giữ.
          Số dư còn lại của các tài khoản này (tổng {pending ? money(pending.remain) : '—'}) sẽ
          bị đóng băng cùng tài khoản, không hoàn lại.
        </InlineAlert>
      </ConfirmAction>
    </Dialog>
  )
}
