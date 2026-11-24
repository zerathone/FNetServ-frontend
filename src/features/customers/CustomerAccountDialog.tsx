import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsClockwise,
  CalendarX,
  CaretDown,
  Eye,
  EyeSlash,
  Key,
  LockKey,
  PencilSimple,
  User,
  UsersThree,
} from '@phosphor-icons/react'
import { updateUserDetail, type UserDetail } from '../../api/users'
import { Button, Dialog, Select } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { CaptchaDialog } from './CaptchaDialog'
import { DateInput, Field } from './CustomerFormFields'
import {
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  describeAccountUpdateError,
  toDraft,
  toUpdateBody,
  validateNewPassword,
  validateUsername,
} from './customerProfileModel'
import { isRbacDenied } from './userAdminModel'

type GroupOption = { id: number; name: string }

type Props = {
  open: boolean
  /** Hồ sơ đầy đủ từ GET /user (cần `version` để máy chủ phát hiện sửa chồng). Chưa có ⇒ không mở. */
  detail: UserDetail | undefined
  /** "hội viên" | "nhân viên": dùng trong nhãn và thông báo. */
  noun: string
  /** Chỉ các nhóm cùng loại với tài khoản (server suy loại tài khoản từ nhóm). */
  groups: GroupOption[]
  groupsLoading: boolean
  canModifyBasic: boolean
  canModifyGroup: boolean
  canModifyPassword: boolean
  canModifyUsername: boolean
  onClose: () => void
}

function randomPassword() {
  const buffer = new Uint32Array(6)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (value) => String(value % 10)).join('')
}

/**
 * Hộp thoại "Tài khoản": nhóm, hoạt động, ngày hết hạn và đổi mật khẩu — tách khỏi tab Hồ sơ (thông tin cá nhân).
 * Gửi cùng PUT /user như tab Hồ sơ: các field khác lấy NGUYÊN từ hồ sơ máy chủ, chỉ field ở đây thay đổi;
 * `password` chỉ được gửi khi người dùng nhập mật khẩu mới.
 */
export function CustomerAccountDialog(props: Props) {
  // Mở lại ⇒ mount mới ⇒ state khởi tạo lại từ hồ sơ mới nhất, không còn mật khẩu gõ dở của lần trước.
  if (!props.open || !props.detail) return null
  return <AccountDialogBody {...props} detail={props.detail} />
}

function AccountDialogBody({
  detail,
  noun,
  groups,
  groupsLoading,
  canModifyBasic,
  canModifyGroup,
  canModifyPassword,
  canModifyUsername,
  onClose,
}: Props & { detail: UserDetail }) {
  const queryClient = useQueryClient()
  const initial = toDraft(detail)
  const [username, setUsername] = useState(initial.username)
  // Tên đăng nhập khóa sẵn (parity MFC): phải qua mã kiểm tra mới sửa được. Mở lại hộp thoại ⇒ khóa lại.
  const [usernameUnlocked, setUsernameUnlocked] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  // Esc/click nền ở hộp thoại mã kiểm tra KHÔNG được đóng luôn hộp thoại Tài khoản: `Dialog` nghe Esc ở cấp document nên
  // cả hai cùng nhận phím. Cờ này giữ `true` đến hết lượt xử lý sự kiện hiện tại (setTimeout 0), sau cả hai listener.
  const captchaOpenRef = useRef(false)
  const usernameInputRef = useRef<HTMLInputElement>(null)

  const openCaptcha = () => {
    captchaOpenRef.current = true
    setCaptchaOpen(true)
  }
  const closeCaptcha = () => {
    setCaptchaOpen(false)
    window.setTimeout(() => {
      captchaOpenRef.current = false
    }, 0)
  }

  useEffect(() => {
    if (usernameUnlocked) usernameInputRef.current?.focus()
  }, [usernameUnlocked])
  const [userGroupId, setUserGroupId] = useState(initial.userGroupId)
  const [active, setActive] = useState(initial.active)
  const [expiryDate, setExpiryDate] = useState(initial.expiryDate)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Cụm đổi mật khẩu mặc định gập: mở dialog là chỉ thấy thông tin tài khoản, bấm nút chìa khóa mới hiện ô nhập.
  const [passwordOpen, setPasswordOpen] = useState(false)

  const togglePassword = () => {
    if (passwordOpen) {
      // Gập lại = bỏ ý định đổi mật khẩu: xóa chữ đã gõ để không lỡ gửi mật khẩu ẩn.
      setPassword('')
      setConfirm('')
      setShowPassword(false)
    }
    setPasswordOpen((value) => !value)
  }

  const passwordError = canModifyPassword && passwordOpen ? validateNewPassword(password, confirm) : null
  // Lỗi "không khớp" chỉ hiện sau khi đã gõ ô nhập lại; trước đó chỉ nhắc nhẹ để người dùng không thấy lỗi đỏ khi vừa gõ xong ô đầu.
  const showPasswordError = Boolean(passwordError) && (confirm.length > 0 || password.trim().length === 0)
  const wantsNewPassword = canModifyPassword && passwordOpen && password.length > 0

  const usernameTrimmed = username.trim()
  const usernameChanged = usernameTrimmed !== initial.username
  // Chỉ kiểm khi đã đổi: tên cũ luôn được giữ nguyên dù (hiếm) không đạt luật tên mới.
  const usernameError = usernameChanged ? validateUsername(username) : null

  const accountChanged =
    usernameChanged ||
    userGroupId !== initial.userGroupId ||
    active !== initial.active ||
    expiryDate !== initial.expiryDate
  const canSubmit = (accountChanged || wantsNewPassword) && !passwordError && !usernameError

  const mutation = useMutation({
    mutationFn: () => {
      const body = toUpdateBody(detail, { ...initial, username: usernameTrimmed, userGroupId, active, expiryDate })
      return updateUserDetail(wantsNewPassword ? { ...body, password } : body)
    },
    onSuccess: () => {
      pushToast(
        wantsNewPassword
          ? `Đã cập nhật tài khoản và đổi mật khẩu ${noun}.`
          : `Đã cập nhật tài khoản ${noun}.`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['user-detail', detail.id] })
      onClose()
    },
    onError: (error) => {
      if (isRbacDenied(error)) return // thông báo thiếu quyền đã được hiện chung
      pushToast(describeAccountUpdateError(error), 'error')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit && !mutation.isPending) mutation.mutate()
  }

  return (
    <>
    <Dialog
      open
      title="Tài khoản"
      description={detail.username}
      size="md"
      onClose={() => {
        if (!mutation.isPending && !captchaOpenRef.current) onClose()
      }}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="submit"
            form="customer-account-form"
            variant="primary"
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            Lưu tài khoản
          </Button>
        </>
      }
    >
      <form
        id="customer-account-form"
        className="customer-create-form customer-create-form--drawer"
        onSubmit={submit}
        noValidate
      >
        <div className="customer-create-form__main">
          <fieldset className="customer-create-form__section">
            <legend>Thông tin tài khoản</legend>
            <div className="customer-create-form__pair customer-create-form__pair--grow customer-create-form__wide">
              <Field
                id="account-username"
                label="Tên đăng nhập"
                icon={<User size={18} weight="bold" aria-hidden="true" />}
                error={usernameError ?? undefined}
                hint={
                  !canModifyUsername
                    ? 'Bạn không có quyền đổi tên đăng nhập.'
                    : !usernameUnlocked
                      ? 'Bấm biểu tượng bút để sửa (cần nhập mã kiểm tra).'
                      : usernameChanged
                        ? 'Sau khi lưu, đăng nhập bằng tên mới.'
                        : undefined
                }
              >
                <>
                  <input
                    ref={usernameInputRef}
                    id="account-username"
                    className="ds-input"
                    placeholder="Tên đăng nhập"
                    maxLength={USERNAME_MAX_LENGTH}
                    autoComplete="off"
                    aria-invalid={Boolean(usernameError)}
                    readOnly={!usernameUnlocked}
                    disabled={!usernameUnlocked || mutation.isPending}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  {!usernameUnlocked ? (
                    <button
                      type="button"
                      className="customer-create-form__affix"
                      aria-label="Sửa tên đăng nhập"
                      title={canModifyUsername ? 'Sửa tên đăng nhập (cần mã kiểm tra)' : 'Bạn không có quyền đổi tên đăng nhập'}
                      disabled={!canModifyUsername || mutation.isPending}
                      onClick={openCaptcha}
                    >
                      <PencilSimple size={18} weight="bold" aria-hidden="true" />
                    </button>
                  ) : null}
                </>
              </Field>
              <label className="customer-create-form__check">
                <input
                  type="checkbox"
                  checked={active}
                  disabled={!canModifyBasic || mutation.isPending}
                  onChange={(event) => setActive(event.target.checked)}
                />
                Hoạt động
              </label>
            </div>
            <Field id="account-group" label={`Nhóm ${noun}`} icon={<UsersThree size={18} weight="bold" aria-hidden="true" />}>
              <Select
                id="account-group"
                className="ds-select"
                value={userGroupId}
                disabled={!canModifyGroup || groupsLoading || mutation.isPending}
                onChange={(event) => setUserGroupId(Number(event.target.value))}
              >
                {!groups.some((group) => group.id === userGroupId) ? (
                  <option value={userGroupId}>{`Nhóm #${userGroupId}`}</option>
                ) : null}
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </Select>
            </Field>
            <Field id="account-expiry" label="Ngày hết hạn (để trống nếu không giới hạn)" icon={<CalendarX size={18} weight="bold" aria-hidden="true" />}>
              <DateInput
                id="account-expiry"
                placeholder="Ngày hết hạn"
                value={expiryDate}
                disabled={!canModifyBasic || mutation.isPending}
                onChange={setExpiryDate}
              />
            </Field>
          </fieldset>

          <div className="customer-account-password">
            <button
              type="button"
              className="customer-account-password__toggle"
              aria-expanded={passwordOpen}
              aria-controls="customer-account-password-panel"
              disabled={!canModifyPassword || mutation.isPending}
              title={!canModifyPassword ? `Bạn không có quyền đổi mật khẩu ${noun}` : undefined}
              onClick={togglePassword}
            >
              <Key size={18} weight="bold" aria-hidden="true" />
              <span>Đổi mật khẩu</span>
              <CaretDown className="customer-account-password__caret" size={16} weight="bold" aria-hidden="true" />
            </button>
            {passwordOpen && canModifyPassword ? (
              <div id="customer-account-password-panel" className="customer-account-password__panel">
                <Field
                  id="account-password"
                  label="Mật khẩu mới"
                  icon={<LockKey size={18} weight="bold" aria-hidden="true" />}
                  wide
                  hint="Để trống nếu giữ nguyên mật khẩu hiện tại."
                >
                  <>
                    <input
                      id="account-password"
                      className="ds-input"
                      placeholder="Mật khẩu mới"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      maxLength={PASSWORD_MAX_LENGTH}
                      disabled={mutation.isPending}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
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
                      disabled={mutation.isPending}
                      onClick={() => {
                        const next = randomPassword()
                        setPassword(next)
                        setConfirm(next)
                        setShowPassword(true)
                      }}
                    >
                      <ArrowsClockwise size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </>
                </Field>
                <Field
                  id="account-password-confirm"
                  label="Nhập lại mật khẩu mới"
                  icon={<LockKey size={18} weight="bold" aria-hidden="true" />}
                  wide
                  error={showPasswordError ? passwordError ?? undefined : undefined}
                  hint={password && !confirm ? 'Nhập lại mật khẩu để xác nhận.' : undefined}
                >
                  <input
                    id="account-password-confirm"
                    className="ds-input"
                    placeholder="Nhập lại mật khẩu mới"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={PASSWORD_MAX_LENGTH}
                    aria-invalid={showPasswordError}
                    disabled={mutation.isPending}
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </Dialog>
    {/* Anh em (không lồng trong Dialog trên) để sự kiện React không nổi bọt sang hộp thoại Tài khoản. */}
    {captchaOpen ? (
      <CaptchaDialog
        description="Nhập các ký tự trong ảnh để mở khóa sửa tên đăng nhập."
        onVerified={() => {
          setUsernameUnlocked(true)
          closeCaptcha()
        }}
        onCancel={closeCaptcha}
        onExhausted={() => {
          closeCaptcha()
          pushToast('Nhập sai mã kiểm tra 3 lần. Hãy bấm biểu tượng bút để thử lại.', 'error')
        }}
      />
    ) : null}
    </>
  )
}
