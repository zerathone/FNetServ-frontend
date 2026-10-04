import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsClockwise,
  Buildings,
  Cake,
  CalendarX,
  Camera,
  DeviceMobile,
  Envelope,
  Eye,
  EyeSlash,
  IdentificationBadge,
  IdentificationCard,
  LockKey,
  MapPin,
  MapTrifold,
  NotePencil,
  Phone,
  Trash,
  UploadSimple,
  User,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react'
import {
  createUser,
  getUserDetail,
  updateUserDetail,
  updateUserPortrait,
  type CccdDraft,
  type CreateUserPayload,
  type UserDetail,
} from '../../api/users'
import { getUserGroups } from '../../api/user-groups'
import { Button, DatePicker, Dialog, Select, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { CustomerCameraDialog } from './CustomerCameraDialog'
import { blobToDataUrl } from './CustomerInspector'
import { CustomerVerificationDialogs } from './CustomerVerificationDialogs'
import { MemberRegisterDialog } from './MemberRegisterDialog'
import './customers.css'

type Props = {
  open: boolean
  kind: 'member' | 'staff'
  onClose: () => void
  /** Gọi sau khi tài khoản đã được lưu (tạo mới hoặc lưu hồ sơ sau đăng ký mobile) và dialog đã đóng. */
  onCreated?: (account: { id: number; username: string; kind: 'member' | 'staff' }) => void
}

type NullableText = 'idNumber' | 'phone' | 'email' | 'address' | 'city' | 'district'
type Draft = Omit<CreateUserPayload, NullableText> & Record<NullableText, string>
type FieldName = 'username' | 'password' | 'group'

const KIND_LABEL = { member: 'hội viên', staff: 'nhân viên' } as const
const GROUP_TYPE_CODE = { member: 2, staff: 4 } as const

const EMPTY_DRAFT: Draft = {
  username: '',
  password: '',
  userGroupId: 0,
  fullName: '',
  idNumber: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  district: '',
  note: '',
  birthday: '',
  gender: 3,
  active: true,
  expiryDate: '',
  isVat: false,
}

function randomPassword() {
  const buffer = new Uint32Array(6)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) => String(value % 10)).join('')
}

type DateInputProps = {
  id: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}

/** Nằm trong khung "icon + ngày" của form tạo: dùng biến thể embedded (khung ngoài đã có viền), chữ gợi ý là placeholder. */
function DateInput({ id, placeholder, value, onChange }: DateInputProps) {
  return (
    <DatePicker
      id={id}
      className="ds-date-picker--embedded"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={onChange}
    />
  )
}

type FieldProps = {
  /** Tên trường: hiện ở tooltip và cho trình đọc màn hình; chữ hiển thị nằm ở placeholder. */
  label: string
  icon: ReactNode
  wide?: boolean
  top?: boolean
  error?: string
  hint?: string
  id: string
  children: ReactNode
}

function Field({ label, icon, wide, top, error, hint, id, children }: FieldProps) {
  const groupClasses = ['ds-input-group', 'customer-create-form__group']
  if (error) groupClasses.push('is-invalid')
  if (top) groupClasses.push('customer-create-form__group--top')
  return (
    <div className={`ds-field customer-create-form__field${wide ? ' customer-create-form__wide' : ''}`}>
      <div className={groupClasses.join(' ')}>
        <label className="ds-input-group-separator customer-create-form__label" htmlFor={id} title={label}>
          {icon}
          <span className="ds-visually-hidden">{label}</span>
        </label>
        {children}
      </div>
      {error ? <span id={`${id}-error`} className="ds-field__error" role="alert">{error}</span> : null}
      {!error && hint ? <span id={`${id}-hint`} className="ds-field__hint">{hint}</span> : null}
    </div>
  )
}

export function CreateUserDialog({ open, kind, onClose, onCreated }: Props) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [portrait, setPortrait] = useState<Blob | null>(null)
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cccdOpen, setCccdOpen] = useState(false)
  // Parity MFC (IDC_CHECK_REGULAR_ACCEPT): mặc định đã tích; bỏ tích thì khóa nút lưu. Không ghi vào DB.
  const [agreed, setAgreed] = useState(true)
  const [registerOpen, setRegisterOpen] = useState(false)
  // Mobile đã đăng ký xong: server đã tạo tài khoản, form chuyển sang sửa chính tài khoản đó
  // (parity MFC: AutoFillFromQr đổi ADD -> UPDATE).
  const [registered, setRegistered] = useState<
    Pick<UserDetail, 'id' | 'version' | 'usageTimeId' | 'isVat'> | null
  >(null)
  const portraitInputRef = useRef<HTMLInputElement>(null)
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }))
  const touch = (name: FieldName) => setTouched((current) => ({ ...current, [name]: true }))

  useEffect(() => {
    if (!portrait) {
      setPortraitUrl(null)
      return
    }
    const url = URL.createObjectURL(portrait)
    setPortraitUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [portrait])

  const applyCccdDraft = useCallback((identity: CccdDraft) => {
    setDraft((current) => ({
      ...current,
      fullName: identity.name || current.fullName,
      idNumber: identity.id || current.idNumber,
      address: identity.address || current.address,
      city: identity.city || current.city,
      district: identity.district || current.district,
      birthday: identity.dob || current.birthday,
      gender: Number(identity.gender) === 2 ? 2 : Number(identity.gender) === 1 ? 1 : 3,
    }))
  }, [])
  const closeCccd = useCallback(() => setCccdOpen(false), [])

  const groupsQuery = useQuery({
    queryKey: ['user-groups', 'create-user'],
    queryFn: getUserGroups,
    enabled: open,
  })
  const groups = useMemo(
    () => (groupsQuery.data ?? []).filter((g) => g.typeCode === GROUP_TYPE_CODE[kind] && g.active),
    [groupsQuery.data, kind],
  )
  const selectedGroupId = groups.some((g) => g.id === draft.userGroupId)
    ? draft.userGroupId
    : groups[0]?.id || 0

  const username = draft.username.trim()
  const errors: Partial<Record<FieldName, string>> = {}
  // Tài khoản đã đăng ký từ mobile: tên đăng nhập khóa, mật khẩu khởi tạo đã do server đặt.
  if (!registered) {
    if (!username) errors.username = 'Nhập tên đăng nhập.'
    else if (username.length > 50 || /['"\\]/.test(username)) errors.username = 'Tối đa 50 ký tự, không chứa dấu nháy hoặc gạch chéo.'
    else if (username.toUpperCase() === 'ADMIN') errors.username = 'Không được dùng tên ADMIN.'
    if (!draft.password) errors.password = 'Nhập mật khẩu hoặc bấm Tạo ngẫu nhiên.'
  }
  if (!selectedGroupId && !groupsQuery.isLoading) errors.group = `Chưa có nhóm ${KIND_LABEL[kind]} đang hoạt động.`

  const reset = () => {
    setDraft(EMPTY_DRAFT)
    setTouched({})
    setShowPassword(false)
    setPortrait(null)
    setRegistered(null)
    setAgreed(true)
  }

  const trimmedProfile = () => ({
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
  })

  const mutation = useMutation({
    retry: false,
    mutationFn: async (): Promise<{ id: number }> => {
      if (registered) {
        const result = await updateUserDetail({
          id: registered.id,
          username,
          userGroupId: selectedGroupId,
          ...trimmedProfile(),
          gender: draft.gender,
          active: draft.active,
          isVat: registered.isVat,
          usageTimeId: registered.usageTimeId,
          expectedVersion: registered.version,
          ...(draft.password ? { password: draft.password } : {}),
        })
        return { id: result.id }
      }
      return createUser({
        ...draft,
        ...trimmedProfile(),
        username,
        userGroupId: selectedGroupId,
      })
    },
    onSuccess: async (result) => {
      pushToast(registered ? `Đã lưu hồ sơ ${KIND_LABEL[kind]} ${username}.` : `Đã tạo ${KIND_LABEL[kind]} ${username}.`, 'success')
      if (portrait && result?.id) {
        try {
          await updateUserPortrait(result.id, await blobToDataUrl(portrait))
        } catch (error) {
          pushToast(`Đã lưu tài khoản nhưng chưa lưu được ảnh: ${(error as Error).message}`, 'error')
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      const savedUsername = username
      reset()
      onClose()
      if (result?.id) onCreated?.({ id: result.id, username: savedUsername, kind })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const close = () => {
    if (mutation.isPending) return
    // Đóng khi đã đăng ký từ mobile: tài khoản đã có trong DB nên làm mới danh sách.
    if (registered) void queryClient.invalidateQueries({ queryKey: ['users'] })
    reset()
    onClose()
  }

  const handleRegistered = async ({ userId }: { userId: number; username: string }) => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    try {
      const detail = await getUserDetail(userId)
      setDraft({
        username: detail.username,
        password: '',
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
      })
      setTouched({})
      setRegistered({ id: detail.id, version: detail.version, usageTimeId: detail.usageTimeId, isVat: detail.isVat })
    } catch (error) {
      pushToast(`Mobile đã đăng ký xong nhưng chưa tải được hồ sơ: ${(error as Error).message}`, 'error')
      reset()
      onClose()
    }
  }

  const trySubmit = () => {
    if (mutation.isPending || !agreed) return
    const firstInvalid = (['username', 'password', 'group'] as const).find((name) => errors[name])
    if (firstInvalid) {
      setTouched({ username: true, password: true, group: true })
      document.getElementById(`create-user-${firstInvalid}`)?.focus()
      return
    }
    mutation.mutate()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    trySubmit()
  }

  const shown = (name: FieldName) => (touched[name] ? errors[name] : undefined)
  const describedBy = (id: string, name?: FieldName) =>
    name && shown(name) ? `${id}-error` : undefined

  return (
    <Dialog
      open={open}
      title={registered ? `Hồ sơ ${KIND_LABEL[kind]} ${username}` : `Thêm ${KIND_LABEL[kind]}`}
      description={
        registered
          ? 'Hội viên đã đăng ký từ mobile và tài khoản đã được tạo. Kiểm tra, bổ sung thông tin rồi bấm Lưu hồ sơ.'
          : 'Số dư ban đầu là 0; nạp tiền ở bước giao dịch riêng.'
      }
      size="lg"
      onClose={close}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={close}>{registered ? 'Đóng' : 'Hủy'}</Button>
          <Button type="submit" form="create-user-form" variant="primary" loading={mutation.isPending} disabled={groupsQuery.isLoading || !agreed}>
            {registered ? 'Lưu hồ sơ' : 'Tạo tài khoản'}
          </Button>
        </>
      }
    >
      {groupsQuery.isError ? (
        <StateView
          title="Không tải được nhóm tài khoản"
          description={(groupsQuery.error as Error).message}
          action={<Button onClick={() => void groupsQuery.refetch()}>Thử lại</Button>}
        />
      ) : (
        <form id="create-user-form" className="customer-create-form" onSubmit={submit} noValidate>
          <aside className="customer-create-form__rail" aria-label={`Ảnh và CCCD ${KIND_LABEL[kind]}`}>
            <div className="customer-portrait-card">
              <div className="customer-portrait-frame">
                {portraitUrl ? (
                  <img src={portraitUrl} alt="Ảnh chân dung xem trước" />
                ) : (
                  <div className="customer-portrait-placeholder">
                    <span aria-hidden="true"><UserCircle size={48} weight="thin" /></span>
                    <strong>Chưa có ảnh</strong>
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
                    if (file) setPortrait(file)
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
                  onClick={() => portraitInputRef.current?.click()}
                />
                {portrait ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="customer-portrait-icon-action"
                    icon={<Trash size={18} weight="bold" aria-hidden="true" />}
                    aria-label="Gỡ ảnh"
                    title="Gỡ ảnh"
                    onClick={() => setPortrait(null)}
                  />
                ) : null}
              </div>
            </div>
            <div className="customer-create-form__scan">
              <Button
                type="button"
                variant="outline"
                icon={<IdentificationCard size={16} weight="bold" aria-hidden="true" />}
                onClick={() => setCccdOpen(true)}
              >
                Quét CCCD
              </Button>
              {kind === 'member' ? (
                registered ? (
                  <small className="ds-field__hint">Đã kết nối mobile.</small>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<DeviceMobile size={16} weight="bold" aria-hidden="true" />}
                      disabled={mutation.isPending}
                      onClick={() => setRegisterOpen(true)}
                    >
                      Kết nối mobile
                    </Button>
                    <small className="ds-field__hint">
                      Dùng Fzone quét mã QR và đăng ký thông tin
                    </small>
                  </>
                )
              ) : null}
            </div>
          </aside>

          <div className="customer-create-form__main">
            <fieldset className="customer-create-form__section">
              <legend>Tài khoản đăng nhập</legend>
              <Field id="create-user-username" label="Tên đăng nhập" icon={<User size={18} weight="bold" aria-hidden="true" />} error={shown('username')}>
                <input
                  id="create-user-username"
                  className="ds-input"
                  placeholder="Tên đăng nhập *"
                  readOnly={Boolean(registered)}
                  maxLength={50}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={Boolean(shown('username'))}
                  aria-describedby={describedBy('create-user-username', 'username')}
                  value={draft.username}
                  onChange={(e) => patch({ username: e.target.value })}
                />
              </Field>
              <Field id="create-user-password" label="Mật khẩu" icon={<LockKey size={18} weight="bold" aria-hidden="true" />} error={shown('password')}>
                <>
                  <input
                    id="create-user-password"
                    className="ds-input"
                    placeholder={registered ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu *'}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={Boolean(shown('password'))}
                    aria-describedby={describedBy('create-user-password', 'password')}
                    value={draft.password}
                    onChange={(e) => patch({ password: e.target.value })}
                    onBlur={() => touch('password')}
                  />
                  <button
                    type="button"
                    className="customer-create-form__affix"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={showPassword}
                    title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeSlash size={18} weight="bold" aria-hidden="true" /> : <Eye size={18} weight="bold" aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="customer-create-form__affix"
                    aria-label="Tạo mật khẩu ngẫu nhiên"
                    title="Tạo mật khẩu ngẫu nhiên (6 chữ số)"
                    onClick={() => {
                      patch({ password: randomPassword() })
                      setShowPassword(true)
                    }}
                  >
                    <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
                  </button>
                </>
              </Field>
              <div className="customer-create-form__pair">
              <Field id="create-user-group" label={`Nhóm ${KIND_LABEL[kind]}`} icon={<UsersThree size={18} weight="bold" aria-hidden="true" />} error={shown('group')}>
                <Select
                  id="create-user-group"
                  className="ds-select"
                  value={selectedGroupId}
                  disabled={groupsQuery.isLoading || !groups.length}
                  aria-invalid={Boolean(shown('group'))}
                  aria-describedby={describedBy('create-user-group', 'group')}
                  onChange={(e) => patch({ userGroupId: Number(e.target.value) })}
                  onBlur={() => touch('group')}
                >
                  {groups.length ? groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>) : <option value={0}>Không có nhóm đang hoạt động</option>}
                </Select>
              </Field>
              <label className="customer-create-form__check">
                <input type="checkbox" checked={draft.active} onChange={(e) => patch({ active: e.target.checked })} />
                Hoạt động
              </label>
              </div>
              <Field id="create-user-expiry" label="Ngày hết hạn (để trống nếu không giới hạn)" icon={<CalendarX size={18} weight="bold" aria-hidden="true" />}>
                <DateInput id="create-user-expiry" placeholder="Ngày hết hạn" value={draft.expiryDate} onChange={(expiryDate) => patch({ expiryDate })} />
              </Field>
            </fieldset>

            <fieldset className="customer-create-form__section">
              <legend>Hồ sơ</legend>
              <Field id="create-user-fullname" label="Họ tên" icon={<IdentificationBadge size={18} weight="bold" aria-hidden="true" />} wide>
                <input id="create-user-fullname" className="ds-input" placeholder="Họ tên" maxLength={30} autoComplete="off" value={draft.fullName} onChange={(e) => patch({ fullName: e.target.value })} />
              </Field>
              <Field id="create-user-idnumber" label="CCCD" icon={<IdentificationCard size={18} weight="bold" aria-hidden="true" />}>
                <input id="create-user-idnumber" className="ds-input" placeholder="CCCD" inputMode="numeric" maxLength={12} autoComplete="off" value={draft.idNumber} onChange={(e) => patch({ idNumber: e.target.value })} />
              </Field>
              <Field id="create-user-birthday" label="Ngày sinh" icon={<Cake size={18} weight="bold" aria-hidden="true" />}>
                <DateInput id="create-user-birthday" placeholder="Ngày sinh" value={draft.birthday} onChange={(birthday) => patch({ birthday })} />
              </Field>
              <Field id="create-user-phone" label="Điện thoại" icon={<Phone size={18} weight="bold" aria-hidden="true" />}>
                <input id="create-user-phone" className="ds-input" placeholder="Điện thoại" readOnly={Boolean(registered)} title={registered ? 'Số điện thoại gắn với tài khoản mobile nên không sửa tại đây' : undefined} type="tel" inputMode="tel" maxLength={30} autoComplete="off" value={draft.phone} onChange={(e) => patch({ phone: e.target.value })} />
              </Field>
              <Field id="create-user-email" label="Email" icon={<Envelope size={18} weight="bold" aria-hidden="true" />}>
                <input id="create-user-email" className="ds-input" placeholder="Email" type="email" inputMode="email" maxLength={100} autoComplete="off" value={draft.email} onChange={(e) => patch({ email: e.target.value })} />
              </Field>
              <Field id="create-user-address" label="Địa chỉ" icon={<MapPin size={18} weight="bold" aria-hidden="true" />} wide>
                <input id="create-user-address" className="ds-input" placeholder="Địa chỉ" maxLength={250} autoComplete="off" value={draft.address} onChange={(e) => patch({ address: e.target.value })} />
              </Field>
              <Field id="create-user-city" label="Tỉnh / thành" icon={<Buildings size={18} weight="bold" aria-hidden="true" />}>
                <input id="create-user-city" className="ds-input" placeholder="Tỉnh / thành" maxLength={50} autoComplete="off" value={draft.city} onChange={(e) => patch({ city: e.target.value })} />
              </Field>
              <Field id="create-user-district" label="Quận / huyện / phường" icon={<MapTrifold size={18} weight="bold" aria-hidden="true" />}>
                <input id="create-user-district" className="ds-input" placeholder="Quận / huyện / phường" maxLength={50} autoComplete="off" value={draft.district} onChange={(e) => patch({ district: e.target.value })} />
              </Field>
              <Field id="create-user-note" label="Ghi chú" icon={<NotePencil size={18} weight="bold" aria-hidden="true" />} wide top hint={`${draft.note.length}/250 ký tự`}>
                <textarea id="create-user-note" className="ds-input customer-profile-form__note" placeholder="Ghi chú" maxLength={250} value={draft.note} onChange={(e) => patch({ note: e.target.value })} />
              </Field>
            </fieldset>

            {/* Parity MFC: IDC_CHECK_REGULAR_ACCEPT + IDC_STC_TERMOFUSE + IDC_STC_PRIVACY_POLICY (cùng 2 URL). */}
            <div className="customer-create-form__terms">
              <label className="customer-create-form__check">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>
                  Đồng ý với{' '}
                  <a
                    className="customer-create-form__link"
                    href="https://fnet.com.vn/chinh-sach-bao-mat/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    thỏa thuận sử dụng
                  </a>
                </span>
              </label>
              <p className="customer-create-form__terms-note">
                Bằng việc {registered ? 'Cập nhật' : 'Thêm'} bạn đã đồng ý với{' '}
                <a
                  className="customer-create-form__link"
                  href="https://fnet.com.vn/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  chính sách bảo vệ dữ liệu cá nhân
                </a>
              </p>
            </div>
          </div>
        </form>
      )}
      <CustomerCameraDialog
        open={cameraOpen}
        fileName={username || 'tai-khoan-moi'}
        onSave={(blob) => {
          setPortrait(blob)
          setCameraOpen(false)
        }}
        onClose={() => setCameraOpen(false)}
      />
      <CustomerVerificationDialogs
        flow={cccdOpen ? 'cccd' : null}
        userId={0}
        username={username}
        fullName={draft.fullName}
        mobilePairDisplay={null}
        onClose={closeCccd}
        onCccdDraft={applyCccdDraft}
        onMobileChanged={closeCccd}
      />
      <MemberRegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={handleRegistered}
      />
    </Dialog>
  )
}
