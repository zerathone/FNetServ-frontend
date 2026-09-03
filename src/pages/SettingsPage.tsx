import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  changeAdminPassword,
  changeAdminWorkstationPassword,
} from '../api/auth'
import {
  getCafeInfo,
  getCloseAppAvailablePc,
  getPriceMinAmount,
  getRetentionSettings,
  getRoundingMoney,
  getShutdownAvailablePc,
  getWorkstationGeneral,
  updateCafeInfo,
  updateCloseAppAvailablePc,
  updatePriceMinAmount,
  updateRetentionSettings,
  updateRoundingMoney,
  updateShutdownAvailablePc,
  updateWorkstationGeneral,
  type RetentionSettings,
} from '../api/settings'
import {
  Button,
  ConfirmAction,
  InlineAlert,
  MoneyInput,
  PageHeader,
  StateView,
} from '../design-system/components'
import { useTheme } from '../design-system/theme/themeContext'
import { useAuthStore } from '../store/auth'
import { pushToast } from '../store/toast'
import {
  DEFAULT_RETENTION_SETTINGS,
  RETENTION_FIELDS,
  validateSystemSettings,
} from '../features/settings/settingsModel'
import './settings.css'

type SettingsSection =
  | 'appearance'
  | 'cafe'
  | 'system'
  | 'workstation'
  | 'security'

type SecurityConfirmation = 'admin' | 'workstation' | null

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection
  label: string
  description: string
}> = [
  { id: 'appearance', label: 'Giao diện', description: 'Theme trên trình duyệt này' },
  { id: 'cafe', label: 'Thông tin phòng máy', description: 'Tên và thông tin liên hệ' },
  { id: 'system', label: 'Quy tắc hệ thống', description: 'Nhật ký, làm tròn và mức nạp' },
  { id: 'workstation', label: 'Máy trạm', description: 'Đăng nhập lại, khóa và tự tắt' },
  { id: 'security', label: 'Bảo mật', description: 'Tài khoản ADMIN và máy trạm' },
]

function validateCredential(
  username: string,
  password: string,
  confirmation: string,
  workstation: boolean,
) {
  const normalized = username.trim()
  if (!normalized) return 'Tên đăng nhập không được để trống'
  if (normalized.length > 32 || password.length > 32) {
    return 'Tên đăng nhập và mật khẩu không được vượt quá 32 ký tự'
  }
  if (!password) return 'Mật khẩu mới không được để trống'
  if (password !== confirmation) return 'Xác nhận mật khẩu chưa khớp'
  if (/['\\]/.test(normalized)) return 'Tên đăng nhập chứa ký tự không hợp lệ'
  if (workstation && /[;|]/.test(`${normalized}${password}`)) {
    return "Tài khoản ADMIN máy trạm không được chứa ';' hoặc '|'"
  }
  return ''
}

export function SettingsPage() {
  const { theme, setTheme, themes } = useTheme()
  const staffName = useAuthStore((state) => state.staffName)
  const updateStaffName = useAuthStore((state) => state.updateStaffName)
  const [section, setSection] = useState<SettingsSection>('appearance')

  const [cafeName, setCafeName] = useState('')
  const [cafeAddress, setCafeAddress] = useState('')
  const [cafePhone, setCafePhone] = useState('')
  const [cafePage, setCafePage] = useState('')
  const [cafeEmail, setCafeEmail] = useState('')
  const [retention, setRetention] = useState<RetentionSettings>(DEFAULT_RETENTION_SETTINGS)
  const [roundingFactor, setRoundingFactor] = useState(1_000)
  const [roundingType, setRoundingType] = useState(0)
  const [priceMin, setPriceMin] = useState<number | null>(null)
  const [priceMinForMember, setPriceMinForMember] = useState<number | null>(null)
  const [showPriceMin, setShowPriceMin] = useState(false)
  const [giveBackMoneyOnline, setGiveBackMoneyOnline] = useState(false)
  const [giveBackMoneyNotOnline, setGiveBackMoneyNotOnline] = useState(false)
  const [chargeMemberWarning, setChargeMemberWarning] = useState(false)
  const [userDeductPriceMin, setUserDeductPriceMin] = useState<number | null>(null)
  const [systemError, setSystemError] = useState('')
  const [autoRelogin, setAutoRelogin] = useState(false)
  const [lockScreenStation, setLockScreenStation] = useState(true)
  const [firstLoginChangePwd, setFirstLoginChangePwd] = useState(false)
  const [chatHistoryStatus, setChatHistoryStatus] = useState(false)
  const [timeOffPcAvailable, setTimeOffPcAvailable] = useState(5)
  const [closeAppAvailableMinutes, setCloseAppAvailableMinutes] = useState(0)
  const [workstationError, setWorkstationError] = useState('')

  const [oldPassword, setOldPassword] = useState('')
  const [newAdminUsername, setNewAdminUsername] = useState(staffName)
  const [newAdminPassword, setNewAdminPassword] = useState('')
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('')
  const [wsAdminUsername, setWsAdminUsername] = useState('')
  const [wsAdminPassword, setWsAdminPassword] = useState('')
  const [confirmWsAdminPassword, setConfirmWsAdminPassword] = useState('')
  const [securityError, setSecurityError] = useState('')
  const [securityConfirmation, setSecurityConfirmation] =
    useState<SecurityConfirmation>(null)
  const [securityResult, setSecurityResult] = useState('')

  const cafeQuery = useQuery({
    queryKey: ['settings', 'cafeinfo'],
    queryFn: getCafeInfo,
  })
  const retentionQuery = useQuery({
    queryKey: ['settings', 'retention'],
    queryFn: getRetentionSettings,
  })
  const roundingQuery = useQuery({
    queryKey: ['settings', 'rounding'],
    queryFn: getRoundingMoney,
  })
  const wsGeneralQuery = useQuery({
    queryKey: ['settings', 'ws-general'],
    queryFn: getWorkstationGeneral,
  })
  const wsShutdownQuery = useQuery({
    queryKey: ['settings', 'ws-shutdown'],
    queryFn: getShutdownAvailablePc,
  })
  const wsCloseAppQuery = useQuery({
    queryKey: ['settings', 'ws-close-app'],
    queryFn: getCloseAppAvailablePc,
  })
  const priceMinQuery = useQuery({
    queryKey: ['settings', 'price-min'],
    queryFn: getPriceMinAmount,
  })

  useEffect(() => {
    if (!cafeQuery.data) return
    setCafeName(cafeQuery.data.cafeName || '')
    setCafeAddress(cafeQuery.data.cafeAddress || '')
    setCafePhone(cafeQuery.data.cafePhone || '')
    setCafePage(cafeQuery.data.cafePage || '')
    setCafeEmail(cafeQuery.data.cafeEmail || '')
  }, [cafeQuery.data])

  useEffect(() => {
    if (retentionQuery.data) {
      setRetention(retentionQuery.data)
    }
  }, [retentionQuery.data])

  useEffect(() => {
    if (roundingQuery.data) {
      setRoundingFactor(roundingQuery.data.roundingUnit ?? 1_000)
      setRoundingType(roundingQuery.data.roundingType ?? 0)
    }
  }, [roundingQuery.data])

  useEffect(() => {
    if (!wsGeneralQuery.data) return
    setAutoRelogin(wsGeneralQuery.data.autoRelogin)
    setLockScreenStation(wsGeneralQuery.data.lockScreenStation)
    setFirstLoginChangePwd(wsGeneralQuery.data.firstLoginChangePwd)
    setChatHistoryStatus(wsGeneralQuery.data.chatHistoryStatus)
  }, [wsGeneralQuery.data])

  useEffect(() => {
    if (wsShutdownQuery.data) {
      setTimeOffPcAvailable(wsShutdownQuery.data.timeOffPcAvailable ?? 5)
    }
  }, [wsShutdownQuery.data])

  useEffect(() => {
    if (wsCloseAppQuery.data) {
      setCloseAppAvailableMinutes(wsCloseAppQuery.data.minutes ?? 0)
    }
  }, [wsCloseAppQuery.data])

  useEffect(() => {
    if (!priceMinQuery.data) return
    setPriceMin(priceMinQuery.data.priceMin)
    setPriceMinForMember(priceMinQuery.data.priceMinForMember)
    setShowPriceMin(priceMinQuery.data.showPriceMin)
    setGiveBackMoneyOnline(priceMinQuery.data.giveBackMoneyOnline)
    setGiveBackMoneyNotOnline(priceMinQuery.data.giveBackMoneyNotOnline)
    setChargeMemberWarning(priceMinQuery.data.chargeMemberWarning)
    setUserDeductPriceMin(priceMinQuery.data.userDeductPriceMin)
  }, [priceMinQuery.data])

  useEffect(() => {
    setNewAdminUsername(staffName)
  }, [staffName])

  const cafeMutation = useMutation({
    mutationFn: updateCafeInfo,
    onSuccess: () => pushToast('Đã lưu thông tin phòng máy.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const retentionMutation = useMutation({
    mutationFn: updateRetentionSettings,
    onSuccess: () => pushToast('Đã lưu thời gian giữ nhật ký.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const roundingMutation = useMutation({
    mutationFn: updateRoundingMoney,
    onSuccess: () => pushToast('Đã lưu quy tắc làm tròn.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const priceMinMutation = useMutation({
    mutationFn: updatePriceMinAmount,
    onSuccess: () => pushToast('Đã lưu mức nạp tối thiểu.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const wsGeneralMutation = useMutation({
    mutationFn: updateWorkstationGeneral,
    onSuccess: () => pushToast('Đã lưu hành vi máy trạm.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const wsShutdownMutation = useMutation({
    mutationFn: updateShutdownAvailablePc,
    onSuccess: () => pushToast('Đã lưu quy tắc tự tắt máy.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const wsCloseAppMutation = useMutation({
    mutationFn: updateCloseAppAvailablePc,
    onSuccess: () => pushToast('Đã lưu thời gian tự đóng ứng dụng.', 'success'),
    onError: (error) => pushToast(error.message, 'error'),
  })
  const adminPasswordMutation = useMutation({
    mutationFn: changeAdminPassword,
    onSuccess: () => {
      const normalizedName = newAdminUsername.trim()
      updateStaffName(normalizedName)
      setOldPassword('')
      setNewAdminPassword('')
      setConfirmAdminPassword('')
      setSecurityConfirmation(null)
      setSecurityResult(
        'Tài khoản ADMIN đã được cập nhật. Các token đăng nhập hiện có vẫn còn hiệu lực theo contract máy chủ.',
      )
      pushToast('Đã đổi tài khoản ADMIN.', 'success')
    },
    onError: (error) => {
      setSecurityConfirmation(null)
      pushToast(error.message, 'error')
    },
  })
  const workstationPasswordMutation = useMutation({
    mutationFn: changeAdminWorkstationPassword,
    onSuccess: () => {
      setWsAdminPassword('')
      setConfirmWsAdminPassword('')
      setSecurityConfirmation(null)
      setSecurityResult(
        'Tài khoản ADMIN máy trạm đã lưu và được phát tới các client đang hoạt động.',
      )
      pushToast('Đã đổi tài khoản ADMIN máy trạm.', 'success')
    },
    onError: (error) => {
      setSecurityConfirmation(null)
      pushToast(error.message, 'error')
    },
  })

  const saveCafe = (event: FormEvent) => {
    event.preventDefault()
    cafeMutation.mutate({
      cafeName: cafeName.trim(),
      cafeAddress: cafeAddress.trim(),
      cafePhone: cafePhone.trim(),
      cafePage: cafePage.trim(),
      cafeEmail: cafeEmail.trim(),
    })
  }

  const saveSystem = (event: FormEvent) => {
    event.preventDefault()
    const validationError = validateSystemSettings({
      retention,
      roundingUnit: roundingFactor,
      priceMin,
      priceMinForMember,
      userDeductPriceMin,
    })
    setSystemError(validationError ?? '')
    if (validationError) return

    retentionMutation.mutate(retention)
    roundingMutation.mutate({ roundingUnit: roundingFactor, roundingType })
    priceMinMutation.mutate({
      priceMin: priceMin as number,
      priceMinForMember: priceMinForMember as number,
      showPriceMin,
      giveBackMoneyOnline,
      giveBackMoneyNotOnline,
      chargeMemberWarning,
      userDeductPriceMin: userDeductPriceMin as number,
    })
  }

  const saveWorkstation = (event: FormEvent) => {
    event.preventDefault()
    if (
      !Number.isInteger(timeOffPcAvailable) ||
      timeOffPcAvailable < 0 ||
      !Number.isInteger(closeAppAvailableMinutes) ||
      closeAppAvailableMinutes < 0 ||
      closeAppAvailableMinutes > 99_999
    ) {
      setWorkstationError('Thời gian phải là số phút nguyên từ 0 đến 99.999; giá trị 0 sẽ tắt tự động hóa tương ứng.')
      return
    }
    setWorkstationError('')
    wsGeneralMutation.mutate({
      autoRelogin,
      lockScreenStation,
      firstLoginChangePwd,
      chatHistoryStatus,
    })
    wsShutdownMutation.mutate({ timeOffPcAvailable })
    wsCloseAppMutation.mutate({ minutes: closeAppAvailableMinutes })
  }

  const requestAdminPasswordChange = (event: FormEvent) => {
    event.preventDefault()
    const error =
      !oldPassword
        ? 'Hãy nhập mật khẩu hiện tại'
        : validateCredential(
            newAdminUsername,
            newAdminPassword,
            confirmAdminPassword,
            false,
          )
    setSecurityError(error)
    if (!error) setSecurityConfirmation('admin')
  }

  const requestWorkstationPasswordChange = (event: FormEvent) => {
    event.preventDefault()
    const error = validateCredential(
      wsAdminUsername,
      wsAdminPassword,
      confirmWsAdminPassword,
      true,
    )
    setSecurityError(error)
    if (!error) setSecurityConfirmation('workstation')
  }

  const queriesForSection =
    section === 'cafe'
      ? [cafeQuery]
      : section === 'system'
        ? [retentionQuery, roundingQuery, priceMinQuery]
        : section === 'workstation'
          ? [wsGeneralQuery, wsShutdownQuery, wsCloseAppQuery]
          : []
  const loadingSection = queriesForSection.some((query) => query.isLoading)
  const sectionError = queriesForSection.find((query) => query.isError)

  return (
    <section className="settings-page">
      <PageHeader
        eyebrow="Quản trị"
        title="Cài đặt"
        description="Cấu hình theo phạm vi rõ ràng; thay đổi giao diện chỉ áp dụng cho trình duyệt hiện tại."
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Danh mục cài đặt">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'is-active' : ''}
              onClick={() => {
                setSection(item.id)
                setSecurityError('')
                setSecurityResult('')
                setSystemError('')
                setWorkstationError('')
              }}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {loadingSection ? (
            <StateView title="Đang tải cài đặt" />
          ) : sectionError ? (
            <StateView
              title="Không tải được cài đặt"
              description={(sectionError.error as Error).message}
              action={<Button onClick={() => queriesForSection.forEach((query) => query.refetch())}>Thử lại</Button>}
            />
          ) : null}

          {section === 'appearance' ? (
            <div className="settings-section">
              <header>
                <h2>Giao diện</h2>
                <p>Preference trình duyệt · không gửi lên máy chủ · không chứa dữ liệu khách hàng.</p>
              </header>
              <div className="settings-theme-grid">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={theme === item.id ? 'is-active' : ''}
                    onClick={() => setTheme(item.id)}
                  >
                    <span className={`settings-theme-swatch settings-theme-swatch--${item.id}`} />
                    <strong>{item.label}</strong>
                    <small>{theme === item.id ? 'Đang sử dụng' : 'Áp dụng ngay'}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {section === 'cafe' && cafeQuery.data ? (
            <form className="settings-section" onSubmit={saveCafe}>
              <header>
                <h2>Thông tin phòng máy</h2>
                <p>Phạm vi hệ thống · dùng trên biên nhận và thông tin liên hệ.</p>
              </header>
              <div className="settings-form-grid">
                <label className="ds-field settings-span-2">
                  <span className="ds-field__label">Tên phòng máy</span>
                  <input className="ds-input" value={cafeName} maxLength={100} required onChange={(event) => setCafeName(event.target.value)} />
                </label>
                <label className="ds-field settings-span-2">
                  <span className="ds-field__label">Địa chỉ</span>
                  <input className="ds-input" value={cafeAddress} maxLength={200} required onChange={(event) => setCafeAddress(event.target.value)} />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Số điện thoại</span>
                  <input className="ds-input" value={cafePhone} inputMode="tel" onChange={(event) => setCafePhone(event.target.value)} />
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Email</span>
                  <input className="ds-input" type="email" value={cafeEmail} onChange={(event) => setCafeEmail(event.target.value)} />
                </label>
                <label className="ds-field settings-span-2">
                  <span className="ds-field__label">Website / Page</span>
                  <input className="ds-input" value={cafePage} onChange={(event) => setCafePage(event.target.value)} />
                </label>
              </div>
              <footer>
                <Button type="submit" variant="primary" loading={cafeMutation.isPending}>
                  Lưu thông tin
                </Button>
              </footer>
            </form>
          ) : null}

          {section === 'system' && retentionQuery.data && roundingQuery.data && priceMinQuery.data ? (
            <form className="settings-section" onSubmit={saveSystem}>
              <header>
                <h2>Quy tắc hệ thống</h2>
                <p>Phạm vi hệ thống · thay đổi ảnh hưởng tất cả nhân viên và giao dịch mới.</p>
              </header>
              {systemError ? <InlineAlert tone="danger">{systemError}</InlineAlert> : null}
              <InlineAlert tone="warning">
                Đặt thời gian giữ là 0 để tắt dọn tự động cho loại nhật ký đó. Giảm thời gian giữ có thể làm dữ liệu cũ bị xóa trong đợt dọn tiếp theo.
              </InlineAlert>
              <div className="settings-form-grid">
                {RETENTION_FIELDS.map((field) => (
                  <label key={field.key} className="ds-field">
                    <span className="ds-field__label">{field.label} ({field.hint})</span>
                    <input
                      className="ds-input"
                      type="number"
                      min={0}
                      max={field.max}
                      step={1}
                      value={retention[field.key]}
                      required
                      onChange={(event) => setRetention((current) => ({
                        ...current,
                        [field.key]: Number(event.target.value),
                      }))}
                    />
                  </label>
                ))}
                <label className="ds-field">
                  <span className="ds-field__label">Đơn vị làm tròn (VND)</span>
                  <input className="ds-input" type="number" min={2} step={2} value={roundingFactor} required onChange={(event) => setRoundingFactor(Number(event.target.value))} />
                </label>
                <fieldset className="settings-radio-group">
                  <legend>Kiểu làm tròn</legend>
                  <label>
                    <input type="radio" name="rounding-type" value="0" checked={roundingType === 0} onChange={() => setRoundingType(0)} />
                    Làm tròn trung bình
                  </label>
                  <label>
                    <input type="radio" name="rounding-type" value="1" checked={roundingType === 1} onChange={() => setRoundingType(1)} />
                    Làm tròn lên
                  </label>
                </fieldset>
                <MoneyInput label="Mức nạp tối thiểu · khách" value={priceMin} onChange={setPriceMin} />
                <MoneyInput label="Mức nạp tối thiểu · hội viên" value={priceMinForMember} onChange={setPriceMinForMember} />
                <MoneyInput label="Số dư tối thiểu để khấu trừ · hội viên" value={userDeductPriceMin} onChange={setUserDeductPriceMin} hint="Số dư tài khoản chính cần giữ lại khi thanh toán." />
              </div>
              <div className="settings-toggle-list">
                <label>
                  <span><strong>Hiển thị mức nạp tối thiểu</strong><small>Hiển thị yêu cầu số tiền tối thiểu trên máy trạm khi khách đăng nhập.</small></span>
                  <input type="checkbox" checked={showPriceMin} onChange={(event) => setShowPriceMin(event.target.checked)} />
                </label>
                <label>
                  <span><strong>Hoàn tiền khi ngừng sử dụng</strong><small>Áp dụng khi khách chủ động kết thúc phiên trực tuyến.</small></span>
                  <input type="checkbox" checked={giveBackMoneyOnline} onChange={(event) => setGiveBackMoneyOnline(event.target.checked)} />
                </label>
                <label>
                  <span><strong>Hoàn tiền khi mất kết nối</strong><small>Áp dụng khi mất điện hoặc client mất kết nối.</small></span>
                  <input type="checkbox" checked={giveBackMoneyNotOnline} onChange={(event) => setGiveBackMoneyNotOnline(event.target.checked)} />
                </label>
                <label>
                  <span><strong>Tiếp tục tính tiền khi mất kết nối</strong><small>Tiếp tục tính tiền hội viên khi máy trạm gửi cảnh báo mất kết nối.</small></span>
                  <input type="checkbox" checked={chargeMemberWarning} onChange={(event) => setChargeMemberWarning(event.target.checked)} />
                </label>
              </div>
              <footer>
                <Button
                  type="submit"
                  variant="primary"
                  loading={
                    retentionMutation.isPending ||
                    roundingMutation.isPending ||
                    priceMinMutation.isPending
                  }
                >
                  Lưu quy tắc
                </Button>
              </footer>
            </form>
          ) : null}

          {section === 'workstation' && wsGeneralQuery.data && wsShutdownQuery.data && wsCloseAppQuery.data ? (
            <form className="settings-section" onSubmit={saveWorkstation}>
              <header>
                <h2>Máy trạm</h2>
                <p>Phạm vi hệ thống · hành vi client khi đăng nhập, chờ và mất kết nối.</p>
              </header>
              <div className="settings-toggle-list">
                <label>
                  <span><strong>Tự đăng nhập lại</strong><small>Khôi phục phiên sau khi client rớt mạng.</small></span>
                  <input type="checkbox" checked={autoRelogin} onChange={(event) => setAutoRelogin(event.target.checked)} />
                </label>
                <label>
                  <span><strong>Khóa màn hình khi không dùng</strong><small>Giữ client ở màn hình khóa trong trạng thái chờ.</small></span>
                  <input type="checkbox" checked={lockScreenStation} onChange={(event) => setLockScreenStation(event.target.checked)} />
                </label>
                <label>
                  <span><strong>Đổi mật khẩu lần đầu</strong><small>Yêu cầu khách đổi mật khẩu sau lần đăng nhập đầu.</small></span>
                  <input type="checkbox" checked={firstLoginChangePwd} onChange={(event) => setFirstLoginChangePwd(event.target.checked)} />
                </label>
              </div>
              <fieldset className="settings-radio-group">
                <legend>Lịch sử giao tiếp các phiên sử dụng trước</legend>
                <label>
                  <input type="radio" name="chat-history-status" checked={!chatHistoryStatus} onChange={() => setChatHistoryStatus(false)} />
                  Xóa lịch sử khi bắt đầu phiên mới
                </label>
                <label>
                  <input type="radio" name="chat-history-status" checked={chatHistoryStatus} onChange={() => setChatHistoryStatus(true)} />
                  Lưu lịch sử để xem lại
                </label>
              </fieldset>
              {workstationError ? <InlineAlert tone="danger">{workstationError}</InlineAlert> : null}
              <div className="settings-form-grid">
                <label className="ds-field">
                  <span className="ds-field__label">Tự tắt máy Sẵn sàng sau (phút)</span>
                  <input className="ds-input" type="number" min={0} step={1} value={timeOffPcAvailable} required onChange={(event) => setTimeOffPcAvailable(Number(event.target.value))} />
                  <small>Nhập 0 để không tự tắt máy.</small>
                </label>
                <label className="ds-field">
                  <span className="ds-field__label">Tự đóng ứng dụng trên máy Sẵn sàng sau (phút)</span>
                  <input className="ds-input" type="number" min={0} max={99999} step={1} value={closeAppAvailableMinutes} required onChange={(event) => setCloseAppAvailableMinutes(Number(event.target.value))} />
                  <small>Nhập 0 để không tự đóng ứng dụng.</small>
                </label>
              </div>
              <footer>
                <Button
                  type="submit"
                  variant="primary"
                  loading={wsGeneralMutation.isPending || wsShutdownMutation.isPending || wsCloseAppMutation.isPending}
                >
                  Lưu cấu hình máy trạm
                </Button>
              </footer>
            </form>
          ) : null}

          {section === 'security' ? (
            <div className="settings-security">
              {securityError ? <InlineAlert tone="danger">{securityError}</InlineAlert> : null}
              {securityResult ? <InlineAlert tone="success">{securityResult}</InlineAlert> : null}

              <form className="settings-section" onSubmit={requestAdminPasswordChange}>
                <header>
                  <h2>Tài khoản ADMIN phần mềm</h2>
                  <p>Đổi tên đăng nhập và mật khẩu của đúng ADMIN trong phiên hiện tại.</p>
                </header>
                <InlineAlert tone="info">
                  Tên đăng nhập mới là trường bắt buộc. Nếu chỉ đổi mật khẩu, giữ nguyên tên hiện tại.
                </InlineAlert>
                <div className="settings-form-grid">
                  <label className="ds-field settings-span-2">
                    <span className="ds-field__label">Mật khẩu hiện tại</span>
                    <input className="ds-input" type="password" autoComplete="current-password" value={oldPassword} required onChange={(event) => setOldPassword(event.target.value)} />
                  </label>
                  <label className="ds-field settings-span-2">
                    <span className="ds-field__label">Tên đăng nhập mới</span>
                    <input className="ds-input" value={newAdminUsername} maxLength={32} required onChange={(event) => setNewAdminUsername(event.target.value)} />
                  </label>
                  <label className="ds-field">
                    <span className="ds-field__label">Mật khẩu mới</span>
                    <input className="ds-input" type="password" autoComplete="new-password" value={newAdminPassword} maxLength={32} required onChange={(event) => setNewAdminPassword(event.target.value)} />
                  </label>
                  <label className="ds-field">
                    <span className="ds-field__label">Nhập lại mật khẩu mới</span>
                    <input className="ds-input" type="password" autoComplete="new-password" value={confirmAdminPassword} maxLength={32} required onChange={(event) => setConfirmAdminPassword(event.target.value)} />
                  </label>
                </div>
                <footer>
                  <Button type="submit" variant="primary">Kiểm tra và đổi tài khoản</Button>
                </footer>
              </form>

              <form className="settings-section" onSubmit={requestWorkstationPasswordChange}>
                <header>
                  <h2>Tài khoản ADMIN máy trạm</h2>
                  <p>Dùng để mở quyền ADMIN trên client máy trạm; không phải tài khoản Windows.</p>
                </header>
                <InlineAlert tone="warning">
                  Khi lưu, máy chủ phát thông tin đăng nhập mới tới mọi client đang hoạt động.
                </InlineAlert>
                <div className="settings-form-grid">
                  <label className="ds-field settings-span-2">
                    <span className="ds-field__label">Tên ADMIN máy trạm mới</span>
                    <input className="ds-input" value={wsAdminUsername} maxLength={32} required onChange={(event) => setWsAdminUsername(event.target.value)} />
                  </label>
                  <label className="ds-field">
                    <span className="ds-field__label">Mật khẩu mới</span>
                    <input className="ds-input" type="password" autoComplete="new-password" value={wsAdminPassword} maxLength={32} required onChange={(event) => setWsAdminPassword(event.target.value)} />
                  </label>
                  <label className="ds-field">
                    <span className="ds-field__label">Nhập lại mật khẩu mới</span>
                    <input className="ds-input" type="password" autoComplete="new-password" value={confirmWsAdminPassword} maxLength={32} required onChange={(event) => setConfirmWsAdminPassword(event.target.value)} />
                  </label>
                </div>
                <footer>
                  <Button type="submit" variant="danger">Đổi tài khoản máy trạm</Button>
                </footer>
              </form>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmAction
        open={securityConfirmation === 'admin'}
        title="Đổi tài khoản ADMIN?"
        description="Tên đăng nhập và mật khẩu phần mềm sẽ thay đổi ngay."
        confirmLabel="Đổi tài khoản"
        pending={adminPasswordMutation.isPending}
        onCancel={() => setSecurityConfirmation(null)}
        onConfirm={() =>
          adminPasswordMutation.mutate({
            oldPassword,
            newUsername: newAdminUsername.trim(),
            newPassword: newAdminPassword,
            confirmPassword: confirmAdminPassword,
          })
        }
      >
        <InlineAlert tone="warning">
          Token hiện tại và các phiên đã đăng nhập khác không tự bị vô hiệu sau thao tác này.
        </InlineAlert>
      </ConfirmAction>

      <ConfirmAction
        open={securityConfirmation === 'workstation'}
        title="Phát tài khoản ADMIN mới tới máy trạm?"
        description={`Tên đăng nhập mới: ${wsAdminUsername.trim()}`}
        confirmLabel="Lưu và phát tới client"
        danger
        pending={workstationPasswordMutation.isPending}
        onCancel={() => setSecurityConfirmation(null)}
        onConfirm={() =>
          workstationPasswordMutation.mutate({
            username: wsAdminUsername.trim(),
            newPassword: wsAdminPassword,
            confirmPassword: confirmWsAdminPassword,
          })
        }
      >
        <InlineAlert tone="warning">
          Thông tin mới được broadcast tới toàn bộ client đang hoạt động theo giao thức legacy.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
