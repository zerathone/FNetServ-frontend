import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowBendUpRight,
  ArrowsLeftRight,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  Gift,
  IdentificationCard,
  Receipt,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  UserCircle,
} from '@phosphor-icons/react'
import {
  getUserDetail,
  getUserPortrait,
  updateUserPortrait,
  deleteUserPortrait,
  updateUserDetail,
  type CccdDraft,
  type UpdateUserDetailBody,
  type UserAccount,
  type UserDetail,
} from '../../api/users'
import { getUserGroups } from '../../api/user-groups'
import { Select,
  Button,
  InlineAlert,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { CustomerCameraDialog } from './CustomerCameraDialog'
import { CustomerHistoryDialog, type CustomerHistoryKind } from './CustomerHistoryDialog'
import { CustomerVerificationDialogs } from './CustomerVerificationDialogs'
import {
  createCustomerQrDisplayChannel,
  customerQrDisplayChannelName,
  openCustomerQrDisplay,
} from '../payments/CustomerQrDisplay'

const RIGHTS = {
  GIVE_MONEY: 11,
  MODIFY_USER: 22,
  MODIFY_USER_BASIC: 223,
  MODIFY_USER_GROUP: 224,
  MONEY_TRANSFER: 25,
  VIEW_USER_CONTACT: 27,
} as const

type UserType = 'member' | 'staff' | 'combo'
type CustomerAction = 'deposit' | 'give' | 'credit' | 'payDebt' | 'transfer'
type InspectorTab = 'overview' | 'profile'
type VerificationFlow = 'cccd' | 'mobile-pair' | 'mobile-unpair' | null
type CccdProfileStatus = {
  tone: 'success' | 'warning' | 'danger'
  label: string
}

type ProfileDraft = {
  username: string
  userGroupId: number
  fullName: string
  idNumber: string
  phone: string
  email: string
  address: string
  city: string
  district: string
  note: string
  birthday: string
  gender: 1 | 2 | 3
  active: boolean
  expiryDate: string
  isVat: boolean
  usageTimeId: number
}

export type CustomerInspectorProps = {
  user: UserAccount
  userType: UserType
  canDelete: boolean
  onOpenAction: (action: CustomerAction) => void
  onRequestDelete: () => void
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function formatDate(value: string | null | undefined) {
  if (!value || value === '0000-00-00') return '—'
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function maskSensitive(value: string | undefined) {
  if (!value) return '—'
  const normalized = value.trim()
  if (normalized.length <= 7) return normalized
  return `${normalized.slice(0, 3)}${'•'.repeat(Math.min(5, normalized.length - 7))}${normalized.slice(-4)}`
}

function displayName(user: UserAccount) {
  return `${user.lastName || ''} ${user.firstName || ''}`.trim() || 'Chưa cập nhật'
}

function debtAmount(user: UserAccount) {
  return Math.max(user.debit || 0, Math.abs(Math.min(0, user.moneyRemain || 0)))
}

function initials(user: UserAccount) {
  const name = displayName(user)
  if (name === 'Chưa cập nhật') return user.userName.slice(0, 2).toUpperCase()
  return name
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

function getCccdProfileStatus(detail: UserDetail): CccdProfileStatus {
  if (!detail.idNumber?.trim()) {
    return { tone: 'danger', label: 'Chưa có CCCD' }
  }

  const hasCompleteIdentity = Boolean(
    detail.fullName.trim()
    && detail.address?.trim()
    && detail.city?.trim()
    && detail.district?.trim()
    && detail.birthday
    && detail.birthday !== '0000-00-00'
    && detail.gender !== 3,
  )

  return hasCompleteIdentity
    ? { tone: 'success', label: 'Đủ thông tin CCCD' }
    : { tone: 'warning', label: 'Chưa xác nhận' }
}

function toDraft(detail: UserDetail): ProfileDraft {
  return {
    username: detail.username,
    userGroupId: detail.userGroupId,
    fullName: detail.fullName,
    idNumber: detail.idNumber ?? '',
    phone: detail.phone ?? '',
    email: detail.email ?? '',
    address: detail.address ?? '',
    city: detail.city ?? '',
    district: detail.district ?? '',
    note: detail.note,
    birthday: detail.birthday === '0000-00-00' ? '' : detail.birthday,
    gender: detail.gender,
    active: detail.active,
    expiryDate: detail.expiryDate === '0000-00-00' ? '' : detail.expiryDate,
    isVat: detail.isVat,
    usageTimeId: detail.usageTimeId,
  }
}

function toUpdateBody(
  detail: UserDetail,
  draft: ProfileDraft,
  confirmMobileUnpair = false,
): UpdateUserDetailBody {
  return {
    id: detail.id,
    ...draft,
    fullName: draft.fullName.trim(),
    idNumber: draft.idNumber.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    address: draft.address.trim(),
    city: draft.city.trim(),
    district: draft.district.trim(),
    note: draft.note.trim(),
    birthday: draft.birthday || '0000-00-00',
    expiryDate: draft.expiryDate || '0000-00-00',
    expectedVersion: detail.version,
    confirmMobileUnpair,
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Không đọc được dữ liệu ảnh.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(blob)
  })
}

export function CustomerInspector({
  user,
  userType,
  canDelete,
  onOpenAction,
  onRequestDelete,
}: CustomerInspectorProps) {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview')
  const [detailRequested, setDetailRequested] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [confirmMobileUnpair, setConfirmMobileUnpair] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [historyKind, setHistoryKind] = useState<CustomerHistoryKind | null>(null)
  const [verificationFlow, setVerificationFlow] = useState<VerificationFlow>(null)
  const [mobilePairDisplay, setMobilePairDisplay] = useState<{
    channelId: string
    external: boolean
  } | null>(null)
  const mobilePairChannelIdRef = useRef<string | null>(null)
  const mobilePairPopupRef = useRef<Window | null>(null)
  const portraitInputRef = useRef<HTMLInputElement>(null)

  const canModifyBasic = hasRight(RIGHTS.MODIFY_USER) || hasRight(RIGHTS.MODIFY_USER_BASIC)
  const canModifyGroup = hasRight(RIGHTS.MODIFY_USER) || hasRight(RIGHTS.MODIFY_USER_GROUP)
  const canViewContact = canModifyBasic || hasRight(RIGHTS.VIEW_USER_CONTACT)
  const canEdit = canModifyBasic || canModifyGroup
  const canModifyPortrait = hasRight(RIGHTS.MODIFY_USER)

  useEffect(() => {
    setActiveTab('overview')
    setDetailRequested(false)
    setEditing(false)
    setDraft(null)
    setConfirmMobileUnpair(false)
    setCameraOpen(false)
    setHistoryKind(null)
    setVerificationFlow(null)
  }, [user.userId])

  const detailQuery = useQuery({
    queryKey: ['user-detail', user.userId],
    queryFn: () => getUserDetail(user.userId),
    enabled: userType === 'member' && (activeTab === 'overview' || detailRequested),
    retry: false,
  })

  useEffect(() => {
    if (detailQuery.data) setDraft(toDraft(detailQuery.data))
  }, [detailQuery.data])

  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
    enabled: Boolean(detailQuery.data && editing),
  })
  const memberGroups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.type === 'member'),
    [groupsQuery.data],
  )

  const portraitQuery = useQuery({
    queryKey: ['user-portrait', user.userId],
    queryFn: () => getUserPortrait(user.userId),
    enabled: Boolean(userType === 'member' && detailQuery.data?.portrait.exists),
    retry: false,
  })
  const portraitUrl = useMemo(
    () => portraitQuery.data ? URL.createObjectURL(portraitQuery.data) : null,
    [portraitQuery.data],
  )

  useEffect(() => {
    return () => {
      if (portraitUrl) URL.revokeObjectURL(portraitUrl)
    }
  }, [portraitUrl])

  const syncPortraitExists = (exists: boolean) => {
    queryClient.setQueryData<UserDetail>(['user-detail', user.userId], (current) => (
      current
        ? { ...current, portrait: { ...current.portrait, exists } }
        : current
    ))
  }

  const portraitMutation = useMutation({
    mutationFn: async (blob: Blob) => {
      if (blob.size > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá giới hạn 5 MB.')
      if (!['image/jpeg', 'image/png'].includes(blob.type)) {
        throw new Error('Chỉ nhận ảnh JPEG hoặc PNG.')
      }
      return updateUserPortrait(user.userId, await blobToDataUrl(blob))
    },
    onMutate: () => queryClient.cancelQueries({ queryKey: ['user-portrait', user.userId] }),
    onSuccess: (result, blob) => {
      queryClient.setQueryData<Blob>(['user-portrait', user.userId], blob)
      syncPortraitExists(result.portrait.exists)
      setCameraOpen(false)
      pushToast('Đã cập nhật ảnh hội viên.', 'success')
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const portraitDeleteMutation = useMutation({
    mutationFn: () => deleteUserPortrait(user.userId),
    onMutate: () => queryClient.cancelQueries({ queryKey: ['user-portrait', user.userId] }),
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: ['user-portrait', user.userId], exact: true })
      syncPortraitExists(result.portrait.exists)
      pushToast('Đã gỡ ảnh hội viên.', 'success')
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: (body: UpdateUserDetailBody) => updateUserDetail(body),
    onSuccess: () => {
      pushToast('Đã cập nhật hồ sơ hội viên.', 'success')
      setEditing(false)
      setConfirmMobileUnpair(false)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['user-detail', user.userId] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: () => {
      const detail = detailQuery.data
      if (!detail) throw new Error('Chưa tải được trạng thái tài khoản')
      const nextDraft = { ...toDraft(detail), active: !detail.active }
      return updateUserDetail(toUpdateBody(detail, nextDraft))
    },
    onSuccess: () => {
      pushToast(
        detailQuery.data?.active ? 'Đã ngừng hoạt động tài khoản.' : 'Đã cho phép tài khoản hoạt động.',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['user-detail', user.userId] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const submitProfile = (event: FormEvent) => {
    event.preventDefault()
    const detail = detailQuery.data
    if (!draft || !detail) return
    const phoneChanged = draft.phone.trim() !== (detail.phone ?? '').trim()
    if (phoneChanged && detail.mobile.paired && !confirmMobileUnpair) {
      pushToast('Hãy xác nhận ngắt kết nối mobile trước khi đổi số điện thoại.', 'info')
      return
    }
    updateMutation.mutate(
      toUpdateBody(detail, draft, phoneChanged && detail.mobile.paired),
    )
  }

  const startEditing = () => {
    if (!canEdit) {
      pushToast('Bạn không có quyền sửa hồ sơ hội viên.', 'info')
      return
    }
    setDetailRequested(true)
    setEditing(true)
  }

  const tabs: Array<{ id: InspectorTab; label: string }> =
    userType === 'member'
      ? [
          { id: 'overview', label: 'Tổng quan' },
          { id: 'profile', label: 'Hồ sơ' },
        ]
      : [{ id: 'overview', label: 'Tổng quan' }]

  const phoneChanged = Boolean(
    draft && detailQuery.data && draft.phone.trim() !== (detailQuery.data.phone ?? '').trim(),
  )
  const cccdProfileStatus = detailQuery.data ? getCccdProfileStatus(detailQuery.data) : null

  const applyCccdDraft = useCallback((identity: CccdDraft) => {
    setDetailRequested(true)
    setEditing(true)
    setDraft((current) => current ? {
      ...current,
      fullName: identity.name || current.fullName,
      idNumber: identity.id || current.idNumber,
      address: identity.address || current.address,
      city: identity.city || current.city,
      district: identity.district || current.district,
      birthday: identity.dob || current.birthday,
      gender: Number(identity.gender) === 2 ? 2 : Number(identity.gender) === 1 ? 1 : 3,
    } : current)
  }, [])

  const refreshMobile = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['user-detail', user.userId] })
  }, [queryClient, user.userId])

  const closeMobilePairDisplay = useCallback(() => {
    const channelId = mobilePairChannelIdRef.current
    if (channelId) {
      const channel = new BroadcastChannel(customerQrDisplayChannelName(channelId))
      channel.postMessage({ type: 'ended' })
      channel.close()
    }
    if (mobilePairPopupRef.current && !mobilePairPopupRef.current.closed) {
      mobilePairPopupRef.current.close()
    }
    mobilePairChannelIdRef.current = null
    mobilePairPopupRef.current = null
    setMobilePairDisplay(null)
  }, [])

  useEffect(() => {
    if (verificationFlow !== 'mobile-pair') closeMobilePairDisplay()
  }, [closeMobilePairDisplay, verificationFlow])

  useEffect(() => () => closeMobilePairDisplay(), [closeMobilePairDisplay])

  const beginMobilePairing = () => {
    closeMobilePairDisplay()
    const channelId = createCustomerQrDisplayChannel()
    const popup = openCustomerQrDisplay(channelId)
    mobilePairChannelIdRef.current = channelId
    mobilePairPopupRef.current = popup
    setMobilePairDisplay({ channelId, external: Boolean(popup) })
    if (!popup) {
      pushToast('Trình duyệt đang chặn cửa sổ QR. Hãy cho phép popup để hiển thị cho khách.', 'info')
    }
    setVerificationFlow('mobile-pair')
  }

  return (
    <div className="customer-inspector">
      <div className={`customer-inspector__hero${userType === 'member' ? ' customer-inspector__hero--member' : ''}`}>
        <div className="customer-inspector__identity">
          <div className="customer-avatar" aria-hidden="true">{initials(user)}</div>
          <div className="customer-inspector__identity-copy">
            <strong>{displayName(user)}</strong>
            <span>{user.userName}</span>
            <div className="customer-inspector__status-row">
              <div className="customer-inspector__badges">
                {userType === 'member' ? (
                  <StatusBadge tone="info">{user.groupName || 'Hội viên'}</StatusBadge>
                ) : null}
              </div>
              {userType === 'member' ? (
                <button
                  type="button"
                  className={`customer-mobile-state${detailQuery.data?.mobile.paired ? ' is-paired' : ''}`}
                  disabled={!canModifyBasic || !detailQuery.data}
                  title={
                    !canModifyBasic
                      ? 'Bạn không có quyền thay đổi kết nối mobile'
                      : detailQuery.data?.mobile.paired
                        ? 'Nhấn để ngắt kết nối mobile'
                        : 'Nhấn để kết nối mobile'
                  }
                  onClick={() => detailQuery.data?.mobile.paired ? setVerificationFlow('mobile-unpair') : beginMobilePairing()}
                >
                  <span aria-hidden="true" />
                  {detailQuery.data
                    ? detailQuery.data.mobile.paired ? 'Đã kết nối mobile' : 'Chưa kết nối mobile'
                    : detailQuery.isLoading ? 'Đang tải mobile' : 'Chưa có trạng thái mobile'}
                </button>
              ) : null}
              {userType === 'member' ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={detailQuery.data?.active ?? false}
                  aria-label="Cho phép tài khoản hoạt động"
                  className={`customer-account-state${detailQuery.data?.active ? ' is-active' : ''}`}
                  disabled={!canModifyBasic || !detailQuery.data || toggleActiveMutation.isPending}
                  title={
                    !canModifyBasic
                      ? 'Bạn không có quyền đổi trạng thái tài khoản'
                      : !detailQuery.data
                        ? 'Chưa tải được trạng thái tài khoản từ máy chủ'
                        : undefined
                  }
                  onClick={() => toggleActiveMutation.mutate()}
                >
                  <span aria-hidden="true">✓</span>
                  {detailQuery.data
                    ? detailQuery.data.active
                      ? 'Hoạt động'
                      : 'Dừng hoạt động'
                    : detailQuery.isLoading
                      ? 'Đang tải trạng thái'
                      : 'Chưa có trạng thái'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {userType === 'member' ? (
          <>
            <div className="customer-inspector__wallet-breakdown" aria-label="Chi tiết số dư">
              <div>
                <span>Số dư</span>
                <strong className="is-total">{formatMoney(user.moneyRemain)}</strong>
              </div>
              <div>
                <span>Tài khoản chính</span>
                <strong>{formatMoney(user.moneyMain)}</strong>
              </div>
              <div>
                <span>Khuyến mãi</span>
                <strong>{formatMoney(user.moneySub)}</strong>
              </div>
            </div>
            <div className="customer-inspector__contact-grid">
              <div className="customer-inspector__contact-column">
                <div>
                  <span>Điện thoại</span>
                  <strong>{maskSensitive(user.phone)}</strong>
                </div>
                <div>
                  <span>CCCD</span>
                  <strong>{maskSensitive(user.idNumber)}</strong>
                </div>
              </div>
              <div className="customer-inspector__contact-column">
                <div>
                  <span>Email</span>
                  <strong title={canViewContact ? user.email : undefined}>
                    {canViewContact ? user.email || '—' : 'Cần quyền xem liên hệ'}
                  </strong>
                </div>
                <div>
                  <span>Ngày sinh</span>
                  <strong>{formatDate(detailQuery.data?.birthday)}</strong>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {userType === 'member' ? (
        <section className="customer-action-tray" aria-label="Thao tác ví hội viên">
          <div className="customer-primary-actions">
            <Button
              type="button"
              variant="primary"
              className="customer-primary-action"
              icon={<Plus size={20} weight="bold" aria-hidden="true" />}
              onClick={() => onOpenAction('deposit')}
            >
              Nạp tiền
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="customer-primary-action customer-primary-action--gift"
              icon={<Gift size={20} weight="bold" aria-hidden="true" />}
              disabled={!hasRight(RIGHTS.GIVE_MONEY)}
              title={!hasRight(RIGHTS.GIVE_MONEY) ? `Thiếu quyền ${RIGHTS.GIVE_MONEY}` : undefined}
              onClick={() => onOpenAction('give')}
            >
              Tặng tiền
            </Button>
          </div>
          <div className="customer-secondary-actions">
            <Button
              type="button"
              variant="secondary"
              className="customer-square-action"
              icon={<ArrowBendUpRight size={18} weight="bold" aria-hidden="true" />}
              onClick={() => onOpenAction('credit')}
            >
              Cho mượn
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="customer-square-action"
              icon={<ArrowsLeftRight size={18} weight="bold" aria-hidden="true" />}
              disabled={!hasRight(RIGHTS.MONEY_TRANSFER)}
              title={!hasRight(RIGHTS.MONEY_TRANSFER) ? `Thiếu quyền ${RIGHTS.MONEY_TRANSFER}` : undefined}
              onClick={() => onOpenAction('transfer')}
            >
              Chuyển tiền
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="customer-square-action"
              icon={<CheckCircle size={18} weight="bold" aria-hidden="true" />}
              disabled={debtAmount(user) <= 0}
              onClick={() => onOpenAction('payDebt')}
            >
              Trả nợ
            </Button>
            <Button
              type="button"
              variant="danger"
              className="customer-square-action customer-square-action--danger"
              icon={<Trash size={18} weight="bold" aria-hidden="true" />}
              disabled={!canDelete}
              title={!canDelete ? 'Chỉ quản trị viên được xóa tài khoản' : undefined}
              onClick={onRequestDelete}
            >
              Xóa tài khoản
            </Button>
          </div>
          <div className="customer-history-actions" aria-label="Lịch sử hội viên">
            <Button
              type="button"
              variant="secondary"
              className="customer-history-action"
              icon={<ClockCounterClockwise size={18} weight="bold" aria-hidden="true" />}
              onClick={() => setHistoryKind('usage')}
            >
              Nhật ký sử dụng
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="customer-history-action"
              icon={<Receipt size={18} weight="bold" aria-hidden="true" />}
              onClick={() => setHistoryKind('recharge')}
            >
              Nhật ký nạp tiền
            </Button>
          </div>
        </section>
      ) : null}

      {userType === 'member' ? (
        <CustomerHistoryDialog
          kind={historyKind}
          user={user}
          onClose={() => setHistoryKind(null)}
        />
      ) : null}

      <div className="customer-inspector__tabs" role="tablist" aria-label="Chi tiết hội viên">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="customer-inspector__panel" role="tabpanel">
          {userType === 'member' ? (
            <>
              <section className="customer-lifetime-summary" aria-label="Tổng giao dịch hội viên">
                <div>
                  <span>Đã nạp</span>
                  <strong>{formatMoney(user.moneyPaid)}</strong>
                </div>
                <div>
                  <span>Được tặng</span>
                  <strong>{formatMoney(user.moneyFree)}</strong>
                </div>
                <div>
                  <span>Đã dùng</span>
                  <strong>{formatMoney(user.moneyUsed)}</strong>
                </div>
                <div>
                  <span>Dư nợ</span>
                  <strong className={debtAmount(user) > 0 ? 'is-debt' : ''}>
                    {formatMoney(debtAmount(user))}
                  </strong>
                </div>
              </section>

            </>
          ) : (
            <InlineAlert tone="info">
              Giao dịch ví chỉ áp dụng cho hội viên. Dùng màn quản trị nâng cao cho loại tài khoản này.
            </InlineAlert>
          )}
        </div>
      ) : null}

      {activeTab === 'profile' ? (
        <div className="customer-inspector__panel" role="tabpanel">
          <section>
            <div className="customer-section-heading">
              <div>
                <h3>Thông tin hội viên</h3>
              </div>
              {!editing ? (
                <div className="customer-section-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<IdentificationCard size={16} weight="bold" aria-hidden="true" />}
                    disabled={!canModifyBasic || !detailQuery.data}
                    onClick={() => setVerificationFlow('cccd')}
                  >
                    CCCD
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    icon={<PencilSimple size={16} weight="bold" aria-hidden="true" />}
                    disabled={!canEdit}
                    onClick={startEditing}
                  >
                    Sửa
                  </Button>
                </div>
              ) : null}
            </div>

            {!editing ? (
              <div className="customer-profile-view">
                <dl className="customer-detail-list customer-detail-list--profile">
                  <div><dt>Họ tên</dt><dd>{detailQuery.data?.fullName || displayName(user)}</dd></div>
                  <div><dt>Nhóm</dt><dd>{user.groupName || `#${detailQuery.data?.userGroupId ?? '—'}`}</dd></div>
                  <div><dt>Điện thoại</dt><dd>{detailQuery.data?.canViewContact ? detailQuery.data.phone || '—' : 'Cần quyền xem liên hệ'}</dd></div>
                  <div><dt>Email</dt><dd>{detailQuery.data?.canViewContact ? detailQuery.data.email || '—' : 'Cần quyền xem liên hệ'}</dd></div>
                  <div className="customer-detail-list__cccd">
                    <dt>CCCD</dt>
                    <dd>
                      {detailQuery.data?.canViewContact ? (
                        <>
                          {cccdProfileStatus ? (
                            cccdProfileStatus.tone === 'success' ? (
                              <CheckCircle
                                className="customer-detail-list__cccd-verified"
                                size={18}
                                weight="fill"
                                aria-label={cccdProfileStatus.label}
                              />
                            ) : <StatusBadge tone={cccdProfileStatus.tone}>{cccdProfileStatus.label}</StatusBadge>
                          ) : null}
                          <span>{detailQuery.data.idNumber || '—'}</span>
                        </>
                      ) : 'Cần quyền xem liên hệ'}
                    </dd>
                  </div>
                  <div><dt>Ghi chú</dt><dd className="customer-detail-list__note">{detailQuery.data?.note || user.note || '—'}</dd></div>
                </dl>
                <aside className="customer-portrait-card" aria-label="Ảnh hội viên">
                  <div className="customer-portrait-frame">
                    {portraitUrl ? (
                      <img src={portraitUrl} alt={`Ảnh hội viên ${user.userName}`} />
                    ) : (
                      <div className="customer-portrait-placeholder">
                        <span aria-hidden="true"><UserCircle size={48} weight="thin" /></span>
                        <strong>
                          {portraitQuery.isLoading
                            ? 'Đang tải ảnh'
                            : portraitQuery.isError
                              ? 'Không tải được ảnh'
                              : 'Chưa có ảnh'}
                        </strong>
                      </div>
                    )}
                  </div>
                  <div className="customer-portrait-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      className="customer-portrait-icon-action"
                      icon={<Camera size={18} weight="bold" aria-hidden="true" />}
                      aria-label="Chụp ảnh"
                      title="Chụp ảnh"
                      disabled={!canModifyPortrait}
                      onClick={() => setCameraOpen(true)}
                    />
                    <input
                      ref={portraitInputRef}
                      className="ds-visually-hidden"
                      type="file"
                      accept="image/jpeg,image/png"
                      tabIndex={-1}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) portraitMutation.mutate(file)
                        event.target.value = ''
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="customer-portrait-icon-action"
                      icon={<UploadSimple size={18} weight="bold" aria-hidden="true" />}
                      aria-label="Chọn ảnh"
                      title="Chọn ảnh"
                      loading={portraitMutation.isPending}
                      disabled={!canModifyPortrait}
                      onClick={() => portraitInputRef.current?.click()}
                    />
                    {detailQuery.data?.portrait.exists ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="customer-portrait-icon-action"
                        icon={<Trash size={18} weight="bold" aria-hidden="true" />}
                        aria-label="Gỡ ảnh"
                        title="Gỡ ảnh"
                        loading={portraitDeleteMutation.isPending}
                        disabled={!canModifyPortrait}
                        onClick={() => portraitDeleteMutation.mutate()}
                      />
                    ) : null}
                  </div>
                </aside>
              </div>
            ) : detailQuery.isLoading ? (
              <StateView title="Đang tải hồ sơ đầy đủ" description="Chỉ mở chỉnh sửa sau khi máy chủ trả đủ dữ liệu cần bảo toàn." />
            ) : detailQuery.isError ? (
              <div className="customer-profile-load-error">
                <InlineAlert tone="warning">
                  Chưa thể sửa tại context bar: máy chủ cần bổ sung GET /user?id để trả hồ sơ đầy đủ. Dữ liệu tóm tắt phía trên vẫn xem được và chưa có trường nào bị ghi thay đổi.
                </InlineAlert>
                <div>
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Quay lại</Button>
                  <Button type="button" variant="primary" loading={detailQuery.isFetching} onClick={() => detailQuery.refetch()}>Thử tải lại</Button>
                </div>
              </div>
            ) : draft && detailQuery.data ? (
              <form className="customer-profile-form" onSubmit={submitProfile}>
                <label className="ds-field customer-profile-form__wide">
                  <span className="ds-field__label">Tên đăng nhập</span>
                  <input className="ds-input" value={draft.username} disabled />
                  <small className="ds-field__hint">Đổi tên đăng nhập và mật khẩu là luồng bảo mật riêng.</small>
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Họ tên</span>
                  <input
                    className="ds-input"
                    value={draft.fullName}
                    maxLength={30}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Nhóm</span>
                  <Select
                    className="ds-select"
                    value={draft.userGroupId}
                    disabled={!canModifyGroup || groupsQuery.isLoading}
                    onChange={(event) => setDraft({ ...draft, userGroupId: Number(event.target.value) })}
                  >
                    {!memberGroups.some((group) => group.id === draft.userGroupId) ? (
                      <option value={draft.userGroupId}>{`Nhóm #${draft.userGroupId}`}</option>
                    ) : null}
                    {memberGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </Select>
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Điện thoại</span>
                  <input
                    className="ds-input"
                    value={draft.phone}
                    maxLength={30}
                    disabled={!canModifyBasic}
                    onChange={(event) => {
                      setConfirmMobileUnpair(false)
                      setDraft({ ...draft, phone: event.target.value })
                    }}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">CCCD</span>
                  <input
                    className="ds-input"
                    value={draft.idNumber}
                    maxLength={12}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, idNumber: event.target.value })}
                  />
                </label>
                <label className="ds-field customer-profile-form__wide">
                  <span className="ds-field__label">Email</span>
                  <input
                    className="ds-input"
                    type="email"
                    value={draft.email}
                    maxLength={100}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  />
                </label>
                <label className="ds-field customer-profile-form__wide">
                  <span className="ds-field__label">Địa chỉ</span>
                  <input
                    className="ds-input"
                    value={draft.address}
                    maxLength={250}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Tỉnh / thành</span>
                  <input
                    className="ds-input"
                    value={draft.city}
                    maxLength={50}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Quận / huyện / phường</span>
                  <input
                    className="ds-input"
                    value={draft.district}
                    maxLength={50}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, district: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Ngày sinh</span>
                  <input
                    className="ds-input"
                    type="date"
                    value={draft.birthday}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, birthday: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Ngày hết hạn</span>
                  <input
                    className="ds-input"
                    type="date"
                    value={draft.expiryDate}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, expiryDate: event.target.value })}
                  />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Giới tính</span>
                  <Select
                    className="ds-select"
                    value={draft.gender}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, gender: Number(event.target.value) as 1 | 2 | 3 })}
                  >
                    <option value={1}>Nam</option>
                    <option value={2}>Nữ</option>
                    <option value={3}>Khác / chưa chọn</option>
                  </Select>
                </label>
                <div className="customer-profile-form__checks">
                  <label><input type="checkbox" checked={draft.active} disabled={!canModifyBasic} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Tài khoản hoạt động</label>
                  <label><input type="checkbox" checked={draft.isVat} disabled={!canModifyBasic} onChange={(event) => setDraft({ ...draft, isVat: event.target.checked })} /> Đồng bộ thông tin VAT</label>
                </div>
                <label className="ds-field customer-profile-form__wide">
                  <span className="ds-field__label">Ghi chú</span>
                  <textarea
                    className="ds-input customer-profile-form__note"
                    value={draft.note}
                    maxLength={250}
                    disabled={!canModifyBasic}
                    onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                  />
                  <small className="ds-field__hint">{draft.note.length}/250 ký tự</small>
                </label>

                {phoneChanged && detailQuery.data.mobile.paired ? (
                  <label className="customer-mobile-confirm customer-profile-form__wide">
                    <input
                      type="checkbox"
                      checked={confirmMobileUnpair}
                      onChange={(event) => setConfirmMobileUnpair(event.target.checked)}
                    />
                    <span>
                      Xác nhận ngắt kết nối mobile hiện tại khi đổi số điện thoại. Máy chủ phải xử lý việc này trong cùng giao dịch cập nhật.
                    </span>
                  </label>
                ) : null}

                <div className="customer-profile-form__actions customer-profile-form__wide">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={updateMutation.isPending}
                    onClick={() => {
                      setEditing(false)
                      setDraft(detailQuery.data ? toDraft(detailQuery.data) : null)
                    }}
                  >
                    Hủy
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={updateMutation.isPending}
                    disabled={phoneChanged && detailQuery.data.mobile.paired && !confirmMobileUnpair}
                  >
                    Lưu hồ sơ
                  </Button>
                </div>
              </form>
            ) : null}
          </section>

        </div>
      ) : null}

      <CustomerCameraDialog
        open={cameraOpen}
        fileName={user.userName || `hoi-vien-${user.userId}`}
        saving={portraitMutation.isPending}
        onSave={(blob) => portraitMutation.mutate(blob)}
        onClose={() => setCameraOpen(false)}
      />
      <CustomerVerificationDialogs
        flow={verificationFlow}
        userId={user.userId}
        username={detailQuery.data?.username ?? user.userName}
        fullName={detailQuery.data?.fullName ?? displayName(user)}
        mobilePairDisplay={mobilePairDisplay}
        onClose={() => setVerificationFlow(null)}
        onCccdDraft={applyCccdDraft}
        onMobileChanged={refreshMobile}
      />
    </div>
  )
}
