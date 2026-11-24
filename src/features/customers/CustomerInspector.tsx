import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowBendUpRight,
  ArrowsLeftRight,
  Buildings,
  Cake,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  Envelope,
  Gift,
  IdentificationBadge,
  IdentificationCard,
  MapPin,
  MapTrifold,
  NotePencil,
  Receipt,
  PencilSimple,
  Phone,
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
import {
  Button,
  IconButton,
  InlineAlert,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { CustomerAccountDialog } from './CustomerAccountDialog'
import { CustomerCameraDialog } from './CustomerCameraDialog'
import { DateInput, Field } from './CustomerFormFields'
import { toDraft, toUpdateBody, type ProfileDraft } from './customerProfileModel'
import { UserEditIcon } from './UserEditIcon'
import { CustomerHistoryDialog, type CustomerHistoryKind } from './CustomerHistoryDialog'
import { CustomerVerificationDialogs } from './CustomerVerificationDialogs'
import { StaffFreeTimeDialog } from './StaffFreeTimeDialog'
import {
  createCustomerQrDisplayChannel,
  customerQrDisplayChannelName,
  openCustomerQrDisplay,
} from '../payments/CustomerQrDisplay'

const RIGHTS = {
  GIVE_MONEY: 11,
  MODIFY_USER: 22,
  MODIFY_USER_USERNAME: 221,
  MODIFY_USER_PASSWORD: 222,
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

function initials(user: UserAccount, fullNameOverride?: string) {
  const name = fullNameOverride?.trim() || displayName(user)
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

export function blobToDataUrl(blob: Blob) {
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
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const currentStaffId = useAuthStore((state) => state.staffId)
  // Nhân viên: chỉ có Hồ sơ (không ví, không tổng quan); hội viên giữ nguyên Tổng quan + Hồ sơ.
  const isStaff = userType === 'staff'
  const hasProfile = userType === 'member' || isStaff
  const noun = isStaff ? 'nhân viên' : 'hội viên'
  // Lý do khoá nút "Thời gian miễn phí" (null = được dùng). Server cũng chặn hai điều này; web chặn sớm cho rõ.
  const freeTimeBlockReason = !isAdmin
    ? 'Chỉ quản trị viên được tặng thời gian miễn phí'
    : currentStaffId !== null && currentStaffId === user.userId
      ? 'Không thể tự tặng thời gian cho chính mình'
      : null
  const [activeTab, setActiveTab] = useState<InspectorTab>(isStaff ? 'profile' : 'overview')
  const [detailRequested, setDetailRequested] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [confirmMobileUnpair, setConfirmMobileUnpair] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [historyKind, setHistoryKind] = useState<CustomerHistoryKind | null>(null)
  const [freeTimeOpen, setFreeTimeOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
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
  const canModifyPassword = hasRight(RIGHTS.MODIFY_USER) || hasRight(RIGHTS.MODIFY_USER_PASSWORD)
  // Tab Hồ sơ chỉ còn thông tin cá nhân (quyền "sửa cơ bản"); nhóm / hoạt động / hết hạn / mật khẩu ở hộp thoại Tài khoản.
  const canEdit = canModifyBasic
  const canModifyUsername = hasRight(RIGHTS.MODIFY_USER) || hasRight(RIGHTS.MODIFY_USER_USERNAME)
  const canEditAccount = canModifyBasic || canModifyGroup || canModifyPassword || canModifyUsername
  const canModifyPortrait = hasRight(RIGHTS.MODIFY_USER)

  useEffect(() => {
    setActiveTab(userType === 'staff' ? 'profile' : 'overview')
    setDetailRequested(false)
    setEditing(false)
    setDraft(null)
    setConfirmMobileUnpair(false)
    setCameraOpen(false)
    setHistoryKind(null)
    setFreeTimeOpen(false)
    setAccountOpen(false)
    setVerificationFlow(null)
  }, [user.userId, userType])

  const detailQuery = useQuery({
    queryKey: ['user-detail', user.userId],
    queryFn: () => getUserDetail(user.userId),
    enabled: hasProfile && (activeTab === 'overview' || activeTab === 'profile' || detailRequested),
    retry: false,
  })

  useEffect(() => {
    if (detailQuery.data) setDraft(toDraft(detailQuery.data))
  }, [detailQuery.data])

  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: getUserGroups,
    // Nhân viên: danh sách không trả tên nhóm ⇒ cần tra để hiện tên thay vì "#id" ngay ở chế độ xem.
    enabled: Boolean(detailQuery.data && (accountOpen || isStaff)),
  })
  const detailGroupName = useMemo(
    () => (groupsQuery.data ?? []).find((group) => group.id === detailQuery.data?.userGroupId)?.name ?? '',
    [groupsQuery.data, detailQuery.data?.userGroupId],
  )
  // Chỉ đổi trong cùng loại nhóm: nhân viên ↔ nhóm nhân viên, hội viên ↔ nhóm hội viên (server suy loại tài khoản từ nhóm).
  const memberGroups = useMemo(
    () => (groupsQuery.data ?? []).filter((group) => group.type === (isStaff ? 'staff' : 'member')),
    [groupsQuery.data, isStaff],
  )

  const portraitQuery = useQuery({
    queryKey: ['user-portrait', user.userId],
    queryFn: () => getUserPortrait(user.userId),
    enabled: Boolean(hasProfile && detailQuery.data?.portrait.exists),
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
      pushToast(`Đã cập nhật ảnh ${noun}.`, 'success')
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const portraitDeleteMutation = useMutation({
    mutationFn: () => deleteUserPortrait(user.userId),
    onMutate: () => queryClient.cancelQueries({ queryKey: ['user-portrait', user.userId] }),
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: ['user-portrait', user.userId], exact: true })
      syncPortraitExists(result.portrait.exists)
      pushToast(`Đã gỡ ảnh ${noun}.`, 'success')
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: (body: UpdateUserDetailBody) => updateUserDetail(body),
    onSuccess: () => {
      pushToast(`Đã cập nhật hồ sơ ${noun}.`, 'success')
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
      pushToast(`Bạn không có quyền sửa hồ sơ ${noun}.`, 'info')
      return
    }
    setDetailRequested(true)
    setEditing(true)
  }

  // Nhân viên chỉ có một mục (Hồ sơ) nên không hiện thanh tab.
  const tabs: Array<{ id: InspectorTab; label: string }> =
    userType === 'member'
      ? [
          { id: 'overview', label: 'Tổng quan' },
          { id: 'profile', label: 'Hồ sơ' },
        ]
      : isStaff
        ? []
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
      <div className={`customer-inspector__hero${userType === 'member' || isStaff ? ' customer-inspector__hero--member' : ''}`}>
        <div className="customer-inspector__identity">
          <div className="customer-avatar" aria-hidden="true">
            {initials(user, isStaff ? detailQuery.data?.fullName : undefined)}
          </div>
          <div className="customer-inspector__identity-copy">
            {isStaff ? (
              <>
                {/* Danh sách nhân viên chỉ trả tên đăng nhập ⇒ họ tên lấy từ hồ sơ; chưa có họ tên thì chỉ hiện tên đăng nhập. */}
                <strong>{detailQuery.data?.fullName?.trim() || user.userName}</strong>
                {detailQuery.data?.fullName?.trim() ? <span>{user.userName}</span> : null}
              </>
            ) : (
              <>
                <strong>{displayName(user)}</strong>
                <span>{user.userName}</span>
              </>
            )}
            <div className="customer-inspector__status-row">
              <div className="customer-inspector__badges">
                {userType === 'member' ? (
                  <StatusBadge tone="info">{user.groupName || 'Hội viên'}</StatusBadge>
                ) : null}
                {isStaff ? <StatusBadge tone="info">Nhân viên</StatusBadge> : null}
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
          {hasProfile ? (
            // Góc phải của khối tên: chỉ icon (nhãn ở tooltip/aria). Mở hộp thoại Tài khoản: tên đăng nhập, nhóm, hạn dùng, mật khẩu.
            <IconButton
              type="button"
              variant="secondary"
              className="customer-inspector__account-button"
              label={canEditAccount ? 'Sửa tài khoản' : `Bạn không có quyền sửa tài khoản ${noun}`}
              icon={<UserEditIcon size={26} />}
              disabled={!canEditAccount || !detailQuery.data}
              onClick={() => setAccountOpen(true)}
            />
          ) : null}
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

        {isStaff ? (
          // Liên hệ gọn 2x2 như hội viên; số liệu lấy từ hồ sơ (danh sách nhân viên không trả CCCD/điện thoại/email).
          <div className="customer-inspector__contact-grid">
            <div className="customer-inspector__contact-column">
              <div>
                <span>Điện thoại</span>
                <strong>
                  {detailQuery.data
                    ? detailQuery.data.canViewContact ? maskSensitive(detailQuery.data.phone ?? '') : 'Cần quyền xem liên hệ'
                    : '—'}
                </strong>
              </div>
              <div>
                <span>CCCD</span>
                <strong>
                  {detailQuery.data
                    ? detailQuery.data.canViewContact ? maskSensitive(detailQuery.data.idNumber ?? '') : 'Cần quyền xem liên hệ'
                    : '—'}
                </strong>
              </div>
            </div>
            <div className="customer-inspector__contact-column">
              <div>
                <span>Email</span>
                <strong title={detailQuery.data?.canViewContact ? detailQuery.data.email ?? undefined : undefined}>
                  {detailQuery.data
                    ? detailQuery.data.canViewContact ? detailQuery.data.email || '—' : 'Cần quyền xem liên hệ'
                    : '—'}
                </strong>
              </div>
              <div>
                <span>Ngày sinh</span>
                <strong>{formatDate(detailQuery.data?.birthday)}</strong>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isStaff ? (
        // Chỉ ba thao tác, một hàng: Thời gian miễn phí (+) · Nhật ký sử dụng · Xóa tài khoản (nguy hiểm, tách bằng màu + chữ).
        <section className="customer-staff-actions" aria-label="Thao tác nhân viên">
          <Button
            type="button"
            variant="secondary"
            className="customer-staff-actions__free-time"
            icon={<Plus size={18} weight="bold" aria-hidden="true" />}
            // Chỉ quản trị viên (như MFC: menu "Ghi giờ miễn phí" chỉ bật cho admin) và không tự tặng cho chính mình.
            disabled={freeTimeBlockReason !== null}
            title={freeTimeBlockReason ?? undefined}
            onClick={() => setFreeTimeOpen(true)}
          >
            Thời gian miễn phí
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<ClockCounterClockwise size={18} weight="bold" aria-hidden="true" />}
            onClick={() => setHistoryKind('usage')}
          >
            Nhật ký sử dụng
          </Button>
          <Button
            type="button"
            variant="danger"
            icon={<Trash size={18} weight="bold" aria-hidden="true" />}
            disabled={!canDelete}
            title={!canDelete ? 'Chỉ quản trị viên được xóa tài khoản' : undefined}
            onClick={onRequestDelete}
          >
            Xóa tài khoản
          </Button>
        </section>
      ) : null}

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

      {userType === 'member' || isStaff ? (
        <CustomerHistoryDialog
          kind={historyKind}
          user={isStaff ? { ...user, firstName: detailQuery.data?.fullName ?? '', lastName: '' } : user}
          onClose={() => setHistoryKind(null)}
        />
      ) : null}

      {hasProfile ? (
        <CustomerAccountDialog
          open={accountOpen}
          detail={detailQuery.data}
          noun={noun}
          groups={memberGroups}
          groupsLoading={groupsQuery.isLoading}
          canModifyBasic={canModifyBasic}
          canModifyGroup={canModifyGroup}
          canModifyPassword={canModifyPassword}
          canModifyUsername={canModifyUsername}
          onClose={() => setAccountOpen(false)}
        />
      ) : null}

      {isStaff ? (
        <StaffFreeTimeDialog
          open={freeTimeOpen}
          userId={user.userId}
          displayName={detailQuery.data?.fullName?.trim() || user.userName}
          onClose={() => setFreeTimeOpen(false)}
        />
      ) : null}

      {tabs.length > 0 ? (
        <div className="customer-inspector__tabs" role="tablist" aria-label={`Chi tiết ${noun}`}>
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
      ) : null}

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
            {/* Không có dòng tiêu đề "Thông tin hội viên"/"Hồ sơ nhân viên" (tab đã tên là Hồ sơ); chỉ còn hàng nút,
                và khi đang sửa thì không render để không để lại hàng trống. */}
            {!editing ? (
              <div className="customer-section-heading customer-section-heading--end">
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
              </div>
            ) : null}

            {!editing ? (
              <div className="customer-profile-view">
                <dl className="customer-detail-list customer-detail-list--profile">
                  <div><dt>Họ tên</dt><dd>{detailQuery.data?.fullName || displayName(user)}</dd></div>
                  <div><dt>Nhóm</dt><dd>{user.groupName || detailGroupName || `#${detailQuery.data?.userGroupId ?? '—'}`}</dd></div>
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
                <aside className="customer-portrait-card" aria-label={`Ảnh ${noun}`}>
                  <div className="customer-portrait-frame">
                    {portraitUrl ? (
                      <img src={portraitUrl} alt={`Ảnh ${noun} ${user.userName}`} />
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
              // Phong cách như form "Thêm hội viên" (CreateUserDialog): ô có biểu tượng đứng đầu, nhãn là placeholder,
              // nhóm có tiêu đề nhỏ IN HOA, lưới hai cột. Không có cột ảnh: ảnh sửa ở chế độ xem.
              <form className="customer-create-form customer-create-form--drawer" onSubmit={submitProfile} noValidate>
                <div className="customer-create-form__main">
                  {/* Nhóm / hoạt động / hết hạn / mật khẩu không nằm ở đây: xem CustomerAccountDialog (nút "Tài khoản").
                      Các giá trị đó vẫn nằm trong draft và được gửi lại NGUYÊN như máy chủ trả (toDraft → toUpdateBody). */}
                  <fieldset className="customer-create-form__section">
                    <Field id="profile-fullname" label="Họ tên" icon={<IdentificationBadge size={18} weight="bold" aria-hidden="true" />} wide>
                      <input
                        id="profile-fullname"
                        className="ds-input"
                        placeholder="Họ tên"
                        maxLength={30}
                        autoComplete="off"
                        value={draft.fullName}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
                      />
                    </Field>
                    <Field id="profile-idnumber" label="CCCD" icon={<IdentificationCard size={18} weight="bold" aria-hidden="true" />}>
                      <input
                        id="profile-idnumber"
                        className="ds-input"
                        placeholder="CCCD"
                        inputMode="numeric"
                        maxLength={12}
                        autoComplete="off"
                        value={draft.idNumber}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, idNumber: event.target.value })}
                      />
                    </Field>
                    <Field id="profile-birthday" label="Ngày sinh" icon={<Cake size={18} weight="bold" aria-hidden="true" />}>
                      <DateInput
                        id="profile-birthday"
                        placeholder="Ngày sinh"
                        value={draft.birthday}
                        disabled={!canModifyBasic}
                        onChange={(value) => setDraft({ ...draft, birthday: value })}
                      />
                    </Field>
                    <Field id="profile-phone" label="Điện thoại" icon={<Phone size={18} weight="bold" aria-hidden="true" />}>
                      <input
                        id="profile-phone"
                        className="ds-input"
                        placeholder="Điện thoại"
                        type="tel"
                        inputMode="tel"
                        maxLength={30}
                        autoComplete="off"
                        value={draft.phone}
                        disabled={!canModifyBasic}
                        onChange={(event) => {
                          setConfirmMobileUnpair(false)
                          setDraft({ ...draft, phone: event.target.value })
                        }}
                      />
                    </Field>
                    <Field id="profile-email" label="Email" icon={<Envelope size={18} weight="bold" aria-hidden="true" />}>
                      <input
                        id="profile-email"
                        className="ds-input"
                        placeholder="Email"
                        type="email"
                        inputMode="email"
                        maxLength={100}
                        autoComplete="off"
                        value={draft.email}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      />
                    </Field>
                    <Field id="profile-address" label="Địa chỉ" icon={<MapPin size={18} weight="bold" aria-hidden="true" />} wide>
                      <input
                        id="profile-address"
                        className="ds-input"
                        placeholder="Địa chỉ"
                        maxLength={250}
                        autoComplete="off"
                        value={draft.address}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                      />
                    </Field>
                    <Field id="profile-city" label="Tỉnh / thành" icon={<Buildings size={18} weight="bold" aria-hidden="true" />}>
                      <input
                        id="profile-city"
                        className="ds-input"
                        placeholder="Tỉnh / thành"
                        maxLength={50}
                        autoComplete="off"
                        value={draft.city}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                      />
                    </Field>
                    <Field id="profile-district" label="Quận / huyện / phường" icon={<MapTrifold size={18} weight="bold" aria-hidden="true" />}>
                      <input
                        id="profile-district"
                        className="ds-input"
                        placeholder="Quận / huyện / phường"
                        maxLength={50}
                        autoComplete="off"
                        value={draft.district}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, district: event.target.value })}
                      />
                    </Field>
                    {/* Không có ô nhập "Giới tính": `gender` vẫn nằm trong draft và được gửi lại NGUYÊN GIÁ TRỊ cũ; chỉ đổi khi
                        quét CCCD (applyCccdDraft điền giới tính từ giấy tờ). */}
                    {/* Không có ô "Đồng bộ thông tin VAT": không dùng khi sửa hồ sơ. `isVat` vẫn nằm trong draft và được gửi
                        lại NGUYÊN GIÁ TRỊ cũ từ máy chủ (toDraft → toUpdateBody), nên lưu hồ sơ không làm đổi cờ này. */}
                    <Field
                      id="profile-note"
                      label="Ghi chú"
                      icon={<NotePencil size={18} weight="bold" aria-hidden="true" />}
                      wide
                      top
                      hint={`${draft.note.length}/250 ký tự`}
                    >
                      <textarea
                        id="profile-note"
                        className="ds-input customer-profile-form__note"
                        placeholder="Ghi chú"
                        maxLength={250}
                        value={draft.note}
                        disabled={!canModifyBasic}
                        onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                      />
                    </Field>
                  </fieldset>

                  {phoneChanged && detailQuery.data.mobile.paired ? (
                    <label className="customer-mobile-confirm">
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

                  <div className="customer-profile-form__actions">
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
                </div>
              </form>
            ) : null}
          </section>

        </div>
      ) : null}

      <CustomerCameraDialog
        open={cameraOpen}
        fileName={user.userName || `${isStaff ? 'nhan-vien' : 'hoi-vien'}-${user.userId}`}
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
