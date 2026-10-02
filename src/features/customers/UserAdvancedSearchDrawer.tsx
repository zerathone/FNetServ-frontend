import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getUserGroups } from '../../api/user-groups'
import { usersApi } from '../../api/users'
import { Button, ConfirmAction, Drawer, InlineAlert, Segmented, Select } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  MEMBER_GROUP_TYPE_CODE,
  USER_ADMIN_RIGHTS,
  advHasCriteria,
  defaultAdvForm,
  describeChangeGroupError,
  isCountMismatch,
  isRbacDenied,
  toAdvFilter,
  validateAdvForm,
  type AdvFilter,
  type AdvForm,
  type FormErrors,
  type SortChoice,
  type TriState,
} from './userAdminModel'

const FORM_ID = 'user-adv-search-form'

const SORT_OPTIONS: Array<{ value: SortChoice; label: string }> = [
  { value: 'none', label: 'Không sắp xếp' },
  { value: 'asc', label: 'Tăng dần' },
  { value: 'desc', label: 'Giảm dần' },
]

const TRI_OPTIONS: Array<{ value: TriState; label: string }> = [
  { value: 'any', label: 'Không lọc' },
  { value: 'yes', label: 'Có' },
  { value: 'no', label: 'Không có' },
]

type MoneyKey = 'maxPaid' | 'minPaid' | 'maxRemain' | 'minRemain'
type UseKey = 'useMaxPaid' | 'useMinPaid' | 'useMaxRemain' | 'useMinRemain'

type Props = {
  open: boolean
  onClose: () => void
  /** Bộ lọc ĐÃ bấm "Tìm" (snapshot). Đổi nhóm hàng loạt dùng đúng cái này, không dùng form đang gõ. */
  applied: AdvFilter | null
  /** Tổng số kết quả của `applied` (server). */
  total: number
  canChangeGroup: boolean
  onApply: (filter: AdvFilter) => void
  onClear: () => void
}

type PendingGroup = { groupId: number; groupName: string; count: number }

/**
 * "Tìm kiếm nâng cao" (CUserSearchAdvDlg) trong Drawer. Component luôn được mount ở trang để giữ
 * giá trị form giữa các lần mở; kết quả hiển thị ở danh sách chính của trang.
 */
export function UserAdvancedSearchDrawer({
  open,
  onClose,
  applied,
  total,
  canChangeGroup,
  onApply,
  onClear,
}: Props) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AdvForm>(() => defaultAdvForm())
  const [errors, setErrors] = useState<FormErrors<AdvForm>>({})
  const [groupId, setGroupId] = useState('')
  const [pending, setPending] = useState<PendingGroup | null>(null)

  const groupsQuery = useQuery({
    queryKey: ['user-groups', 'adv-search'],
    queryFn: getUserGroups,
    enabled: open && canChangeGroup,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  // Lọc theo typeCode (KHÔNG theo `type`: user-groups.ts đổi mã lạ về 'member').
  const memberGroups = (groupsQuery.data ?? []).filter(
    (group) => group.typeCode === MEMBER_GROUP_TYPE_CODE,
  )

  const update = <K extends keyof AdvForm>(key: K, value: AdvForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = () => {
    const found = validateAdvForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onApply(toAdvFilter(form))
    onClose()
  }

  const clear = () => {
    setForm(defaultAdvForm())
    setErrors({})
    onClear()
  }

  const refreshAfterGroupChange = () => {
    void queryClient.invalidateQueries({ queryKey: ['users-adv'] })
    void queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
  }

  const previewMutation = useMutation({
    mutationFn: (target: { groupId: number; groupName: string }) =>
      usersApi.changeGroupBulk(applied as AdvFilter, target.groupId, false),
    onSuccess: (result, target) => {
      if (result.changed) {
        pushToast('Phản hồi xem trước không hợp lệ, chưa đổi nhóm.', 'error')
        return
      }
      setPending({ ...target, count: result.count })
    },
    onError: (error) => {
      if (!isRbacDenied(error)) pushToast(describeChangeGroupError(error), 'error')
    },
  })

  const changeMutation = useMutation({
    mutationFn: (target: PendingGroup) =>
      usersApi.changeGroupBulk(applied as AdvFilter, target.groupId, true, target.count),
    onSuccess: (result, target) => {
      setPending(null)
      if (!result.changed) {
        pushToast('Máy chủ chưa đổi nhóm (mới chỉ xem trước).', 'error')
        return
      }
      pushToast(`Đã đổi nhóm ${result.count} tài khoản sang “${target.groupName}”.`, 'success')
      refreshAfterGroupChange()
    },
    onError: (error) => {
      setPending(null)
      if (isRbacDenied(error)) return
      pushToast(describeChangeGroupError(error), 'error')
      // Số lượng đã đổi giữa lúc xem trước và xác nhận -> tải lại kết quả để số liệu đúng.
      if (isCountMismatch(error)) refreshAfterGroupChange()
    },
  })

  const hasCriteria = advHasCriteria(applied)
  const selectedGroup = memberGroups.find((group) => String(group.id) === groupId)
  const groupBlockReason = !canChangeGroup
    ? `Thiếu quyền ${USER_ADMIN_RIGHTS.USERGROUP_MODIFY_USER} để đổi nhóm.`
    : !applied
      ? 'Hãy bấm “Tìm” trước; đổi nhóm áp dụng cho kết quả của lần tìm đó.'
      : total === 0
        ? 'Lần tìm gần nhất không có kết quả.'
        : !hasCriteria
          ? 'Cần ít nhất một điều kiện lọc (sắp xếp không tính).'
          : null

  // Mỗi tiêu chí = 1 khối: checkbox bật/tắt + ô nhập có nhãn hiển thị. Tắt thì mờ và khoá ô nhập.
  const moneyField = (useKey: UseKey, key: MoneyKey, title: string) => (
    <section className={`user-admin__criterion${form[useKey] ? '' : ' is-off'}`}>
      <label className="user-admin__criterion-head">
        <input
          type="checkbox"
          checked={form[useKey]}
          onChange={(event) => update(useKey, event.target.checked)}
        />
        <span>{title}</span>
      </label>
      <label className="ds-field">
        <span className="ds-field__label">Số tiền (đ)</span>
        <input
          className="ds-input user-admin__number"
          inputMode="numeric"
          maxLength={11}
          value={form[key]}
          disabled={!form[useKey]}
          aria-invalid={errors[key] ? true : undefined}
          onChange={(event) => update(key, event.target.value.trim())}
        />
        {errors[key] ? <span className="ds-field__error" role="alert">{errors[key]}</span> : null}
      </label>
    </section>
  )

  const sortField = (key: 'sortPaid' | 'sortRemain') => (
    <label className="ds-field">
      <span className="ds-field__label">Sắp xếp kết quả</span>
      <Select
        value={form[key]}
        onChange={(event) => update(key, event.target.value as SortChoice)}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </label>
  )

  const triField = (key: 'idNumber' | 'phone', label: string) => (
    <div className="user-admin__group">
      <span className="ds-field__label">{label}</span>
      <Segmented
        ariaLabel={label}
        value={form[key]}
        options={TRI_OPTIONS}
        onChange={(value) => update(key, value)}
      />
    </div>
  )
  return (
    <>
      <Drawer
        open={open}
        title="Tìm kiếm nâng cao"
        description="Lọc hội viên theo số tiền, khoảng thời gian nạp, CCCD và điện thoại."
        // Esc ở hộp xác nhận cũng bắn tới Drawer (cùng listener document) — không đóng khi đang xác nhận.
        onClose={pending !== null || changeMutation.isPending ? () => undefined : onClose}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={clear}>
              Xóa bộ lọc
            </Button>
            <Button type="submit" form={FORM_ID} variant="primary">
              Tìm
            </Button>
          </>
        }
      >
        <div className="user-admin">
          <form
            id={FORM_ID}
            className="user-admin__stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <section className="user-admin__section">
              <h3>Đã nạp</h3>
              <div className="user-admin__pair">
                {moneyField('useMinPaid', 'minPaid', 'Tối thiểu')}
                {moneyField('useMaxPaid', 'maxPaid', 'Tối đa')}
              </div>
              {sortField('sortPaid')}
            </section>

            <section className="user-admin__section">
              <h3>Khoảng thời gian nạp</h3>
              <section className={`user-admin__criterion${form.useLapse ? '' : ' is-off'}`}>
                <label className="user-admin__criterion-head">
                  <input
                    type="checkbox"
                    checked={form.useLapse}
                    onChange={(event) => update('useLapse', event.target.checked)}
                  />
                  <span>Chỉ tính tiền nạp trong khoảng</span>
                </label>
                <div className="user-admin__pair">
                  <label className="ds-field">
                    <span className="ds-field__label">Từ ngày</span>
                    <input
                      className="ds-input"
                      type="date"
                      value={form.lapseFrom}
                      disabled={!form.useLapse}
                      aria-invalid={errors.lapseFrom ? true : undefined}
                      onChange={(event) => update('lapseFrom', event.target.value)}
                    />
                    {errors.lapseFrom ? <span className="ds-field__error" role="alert">{errors.lapseFrom}</span> : null}
                  </label>
                  <label className="ds-field">
                    <span className="ds-field__label">Đến ngày</span>
                    <input
                      className="ds-input"
                      type="date"
                      value={form.lapseTo}
                      disabled={!form.useLapse}
                      aria-invalid={errors.lapseTo ? true : undefined}
                      onChange={(event) => update('lapseTo', event.target.value)}
                    />
                    {errors.lapseTo ? <span className="ds-field__error" role="alert">{errors.lapseTo}</span> : null}
                  </label>
                </div>
                <p className="user-admin__hint">
                  Khi bật, cột “Đã nạp” là tổng nạp trong khoảng; cột “Đã dùng” vẫn là tổng cả đời.
                </p>
              </section>
            </section>

            <section className="user-admin__section">
              <h3>Còn lại</h3>
              <div className="user-admin__pair">
                {moneyField('useMinRemain', 'minRemain', 'Tối thiểu')}
                {moneyField('useMaxRemain', 'maxRemain', 'Tối đa')}
              </div>
              {sortField('sortRemain')}
            </section>

            <section className="user-admin__section">
              <h3>Thông tin liên hệ</h3>
              {triField('idNumber', 'Số CCCD')}
              {triField('phone', 'Điện thoại')}
            </section>          </form>

          <section className="user-admin__section user-admin__section--group">
            <h3>Đổi nhóm hàng loạt</h3>
            <p className="user-admin__hint">
              Áp dụng cho <strong>toàn bộ {applied ? new Intl.NumberFormat('vi-VN').format(total) : 0} tài khoản</strong>{' '}
              khớp lần tìm gần nhất (không chỉ trang đang xem). Máy đang online giữ giá cũ tới khi hội
              viên đăng nhập lại.
            </p>
            <div className="user-admin__group-row">
              <label className="ds-field">
                <span className="ds-field__label">Nhóm hội viên mới</span>
                <Select
                  value={groupId}
                  disabled={groupBlockReason !== null || groupsQuery.isLoading}
                  onChange={(event) => setGroupId(event.target.value)}
                >
                  <option value="">Chọn nhóm…</option>
                  {memberGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                      {group.active ? '' : ' (ngừng dùng)'}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                type="button"
                variant="danger-outline"
                loading={previewMutation.isPending}
                disabled={groupBlockReason !== null || !selectedGroup}
                title={groupBlockReason ?? undefined}
                onClick={() =>
                  selectedGroup &&
                  previewMutation.mutate({ groupId: selectedGroup.id, groupName: selectedGroup.name })
                }
              >
                Đổi nhóm
              </Button>
            </div>
            {groupBlockReason ? <InlineAlert tone="info">{groupBlockReason}</InlineAlert> : null}
            {groupsQuery.isError ? (
              <InlineAlert tone="danger">Không tải được danh sách nhóm hội viên.</InlineAlert>
            ) : null}
          </section>
        </div>
      </Drawer>

      <ConfirmAction
        open={pending !== null}
        title="Đổi nhóm hàng loạt?"
        description={pending ? `Đổi nhóm cho TOÀN BỘ ${new Intl.NumberFormat('vi-VN').format(pending.count)} tài khoản khớp bộ lọc (không chỉ trang đang xem) sang nhóm “${pending.groupName}”?` : undefined}
        confirmLabel="Đổi nhóm"
        danger
        pending={changeMutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && changeMutation.mutate(pending)}
      >
        <InlineAlert tone="warning">
          Thao tác ghi trực tiếp vào tài khoản hội viên và không có nút hoàn tác. Nếu số lượng thay
          đổi giữa lúc xem trước và xác nhận, máy chủ sẽ từ chối để bạn kiểm tra lại.
        </InlineAlert>
      </ConfirmAction>
    </>
  )
}
