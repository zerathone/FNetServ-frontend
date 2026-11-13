import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  Segmented,
  StateView,
} from '../design-system/components'
import { useAuthStore } from '../store/auth'
import { pushToast } from '../store/toast'
import {
  DEFAULT_RETENTION_SETTINGS,
  RETENTION_FIELDS,
  RETENTION_GROUPS,
  validateRetentionSettings,
  validateSystemSettings,
} from '../features/settings/settingsModel'
import { parseSettingsSection, SETTINGS_SECTIONS } from '../features/settings/settingsCatalog'
import { ChatSettingsSection } from '../features/chat/ChatSettingsSection'
import { WorkstationMapEditor } from '../features/workstations/map/WorkstationMapEditor'
import { ClientSystemFunctionDialog } from '../features/workstations/ClientSystemFunctionDialog'
import { ScheduledShutdownDialog } from '../features/workstations/ScheduledShutdownDialog'
import './settings.css'

const RIGHT_SHUTDOWN_ALL = 131

type SecurityConfirmation = 'admin' | 'workstation' | null

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
  const staffName = useAuthStore((state) => state.staffName)
  const updateStaffName = useAuthStore((state) => state.updateStaffName)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const hasRight = useAuthStore((state) => state.hasRight)
  // Mục đang mở nằm trên URL (?section=&focus=) để thanh tìm kiếm menu deep-link được vào từng cài đặt con.
  const [searchParams, setSearchParams] = useSearchParams()
  const section = parseSettingsSection(searchParams.get('section'))
  const focusAnchor = searchParams.get('focus')
  const setSection = (next: typeof section) => setSearchParams({ section: next }, { replace: true })
  const [systemFunctionsOpen, setSystemFunctionsOpen] = useState(false)
  const [shutdownScheduleOpen, setShutdownScheduleOpen] = useState(false)

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
  const [retentionError, setRetentionError] = useState('')
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
      roundingUnit: roundingFactor,
      priceMin,
      priceMinForMember,
      userDeductPriceMin,
    })
    setSystemError(validationError ?? '')
    if (validationError) return

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

  const saveRetention = (event: FormEvent) => {
    event.preventDefault()
    const validationError = validateRetentionSettings(retention)
    setRetentionError(validationError ?? '')
    if (validationError) return
    retentionMutation.mutate(retention)
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
    section === 'general'
      ? [cafeQuery, roundingQuery, priceMinQuery]
      : section === 'workstation'
        ? [wsGeneralQuery, wsShutdownQuery, wsCloseAppQuery]
        : section === 'security'
          ? [retentionQuery]
          : []
  const loadingSection = queriesForSection.some((query) => query.isLoading)
  const sectionError = queriesForSection.find((query) => query.isError)

  // Đến từ tìm kiếm menu (?focus=): chờ mục tải xong rồi cuộn tới đúng cài đặt + nháy sáng.
  useEffect(() => {
    if (!focusAnchor || loadingSection) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`setting-${focusAnchor}`)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.classList.add('settings-flash')
      window.setTimeout(() => target.classList.remove('settings-flash'), 2200)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusAnchor, section, loadingSection])

  return (
    <section className="settings-page">
      <PageHeader
        eyebrow="Quản trị"
        title="Cài đặt"
        description="Cấu hình theo phạm vi rõ ràng; thay đổi ở đây ảnh hưởng toàn hệ thống."
      />

      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Danh mục cài đặt">
          <Segmented
            ariaLabel="Danh mục cài đặt"
            value={section}
            options={SETTINGS_SECTIONS.map((item) => ({
              value: item.id,
              label: item.label,
              title: item.description,
            }))}
            onChange={(next) => {
              setSection(next)
              setSecurityError('')
              setSecurityResult('')
              setSystemError('')
              setRetentionError('')
              setWorkstationError('')
            }}
          />
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

          {section === 'general' && cafeQuery.data ? (
            <form className="settings-section settings-section--compact" onSubmit={saveCafe}>
              <header>
                <h2>Thông tin phòng máy</h2>
                <p>Hiển thị trên biên nhận và thông tin liên hệ.</p>
              </header>
              <div className="settings-grid settings-grid--3">
                <label className="ds-field settings-span-all">
                  <span className="ds-field__label">Tên phòng máy</span>
                  <input className="ds-input" value={cafeName} maxLength={100} required onChange={(event) => setCafeName(event.target.value)} />
                </label>
                <label className="ds-field settings-span-all">
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
                <label className="ds-field">
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

          {section === 'general' && roundingQuery.data && priceMinQuery.data ? (
            <form className="settings-section settings-section--compact" onSubmit={saveSystem}>
              <header>
                <h2>Quy tắc hệ thống</h2>
                <p>Thay đổi ảnh hưởng tất cả nhân viên và giao dịch mới.</p>
              </header>
              {systemError ? <InlineAlert tone="danger">{systemError}</InlineAlert> : null}

              <section className="settings-group" aria-labelledby="settings-group-rounding">
                <h3 id="settings-group-rounding" className="settings-group__title">Làm tròn tiền</h3>
                <div className="settings-grid settings-grid--3">
                  <label id="setting-rounding" className="ds-field">
                    <span className="ds-field__label">Đơn vị làm tròn (VND)</span>
                    <input className="ds-input" type="number" min={2} step={2} value={roundingFactor} required onChange={(event) => setRoundingFactor(Number(event.target.value))} />
                  </label>
                  <div id="setting-rounding-type" className="ds-field settings-segmented-field">
                    <span className="ds-field__label">Kiểu làm tròn</span>
                    <Segmented
                      ariaLabel="Kiểu làm tròn"
                      value={roundingType === 1 ? '1' : '0'}
                      options={[
                        { value: '0', label: 'Trung bình' },
                        { value: '1', label: 'Làm tròn lên' },
                      ]}
                      onChange={(value) => setRoundingType(value === '1' ? 1 : 0)}
                    />
                  </div>
                </div>
              </section>

              <section className="settings-group" aria-labelledby="settings-group-min">
                <h3 id="settings-group-min" className="settings-group__title">Mức nạp tối thiểu</h3>
                <div className="settings-grid settings-grid--3">
                  <MoneyInput label="Khách" value={priceMin} onChange={setPriceMin} />
                  <MoneyInput label="Hội viên" value={priceMinForMember} onChange={setPriceMinForMember} />
                  <MoneyInput label="Số dư tối thiểu để khấu trừ" value={userDeductPriceMin} onChange={setUserDeductPriceMin} hint="Hội viên: số dư tài khoản chính cần giữ lại khi thanh toán." />
                </div>
                <div className="settings-toggle-list settings-toggle-list--compact">
                  <label id="setting-show-min">
                    <span><strong>Hiển thị mức nạp tối thiểu</strong><small>Hiển thị yêu cầu số tiền tối thiểu trên máy trạm khi khách đăng nhập.</small></span>
                    <input type="checkbox" checked={showPriceMin} onChange={(event) => setShowPriceMin(event.target.checked)} />
                  </label>
                </div>
              </section>

              <section className="settings-group" aria-labelledby="settings-group-refund">
                <h3 id="settings-group-refund" className="settings-group__title">Hoàn tiền và mất kết nối</h3>
                <div className="settings-toggle-list settings-toggle-list--compact">
                  <label id="setting-refund-online">
                    <span><strong>Hoàn tiền khi ngừng sử dụng</strong><small>Áp dụng khi khách chủ động kết thúc phiên trực tuyến.</small></span>
                    <input type="checkbox" checked={giveBackMoneyOnline} onChange={(event) => setGiveBackMoneyOnline(event.target.checked)} />
                  </label>
                  <label id="setting-refund-offline">
                    <span><strong>Hoàn tiền khi mất kết nối</strong><small>Áp dụng khi mất điện hoặc client mất kết nối.</small></span>
                    <input type="checkbox" checked={giveBackMoneyNotOnline} onChange={(event) => setGiveBackMoneyNotOnline(event.target.checked)} />
                  </label>
                  <label id="setting-charge-warning">
                    <span><strong>Tiếp tục tính tiền khi mất kết nối</strong><small>Tiếp tục tính tiền hội viên khi máy trạm gửi cảnh báo mất kết nối.</small></span>
                    <input type="checkbox" checked={chargeMemberWarning} onChange={(event) => setChargeMemberWarning(event.target.checked)} />
                  </label>
                </div>
              </section>

              <footer>
                <Button
                  type="submit"
                  variant="primary"
                  loading={roundingMutation.isPending || priceMinMutation.isPending}
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
              <div id="setting-sys-functions" className="settings-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!isAdmin}
                  title={!isAdmin ? 'Chỉ quản trị viên được cấu hình chức năng hệ thống.' : undefined}
                  onClick={() => setSystemFunctionsOpen(true)}
                >
                  Chức năng hệ thống
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!hasRight(RIGHT_SHUTDOWN_ALL)}
                  title={!hasRight(RIGHT_SHUTDOWN_ALL) ? `Thiếu quyền ${RIGHT_SHUTDOWN_ALL}` : undefined}
                  onClick={() => setShutdownScheduleOpen(true)}
                >
                  Lịch tắt máy
                </Button>
              </div>
              <div className="settings-toggle-list">
                <label id="setting-auto-relogin">
                  <span><strong>Tự đăng nhập lại</strong><small>Khôi phục phiên sau khi client rớt mạng.</small></span>
                  <input type="checkbox" checked={autoRelogin} onChange={(event) => setAutoRelogin(event.target.checked)} />
                </label>
                <label id="setting-lock-screen">
                  <span><strong>Khóa màn hình khi không dùng</strong><small>Giữ client ở màn hình khóa trong trạng thái chờ.</small></span>
                  <input type="checkbox" checked={lockScreenStation} onChange={(event) => setLockScreenStation(event.target.checked)} />
                </label>
                <label id="setting-first-login-pwd">
                  <span><strong>Đổi mật khẩu lần đầu</strong><small>Yêu cầu khách đổi mật khẩu sau lần đăng nhập đầu.</small></span>
                  <input type="checkbox" checked={firstLoginChangePwd} onChange={(event) => setFirstLoginChangePwd(event.target.checked)} />
                </label>
              </div>
              <fieldset id="setting-chat-history" className="settings-radio-group">
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
                <label id="setting-auto-off" className="ds-field">
                  <span className="ds-field__label">Tự tắt máy Sẵn sàng sau (phút)</span>
                  <input className="ds-input" type="number" min={0} step={1} value={timeOffPcAvailable} required onChange={(event) => setTimeOffPcAvailable(Number(event.target.value))} />
                  <small>Nhập 0 để không tự tắt máy.</small>
                </label>
                <label id="setting-auto-close-app" className="ds-field">
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

          {/* Kênh chat Messenger: form riêng (PUT /settings/chat riêng, chỉ admin) nên KHÔNG lồng trong form máy trạm. */}
          {section === 'workstation' ? (
            <div id="setting-chat-channel">
              <ChatSettingsSection isAdmin={isAdmin} />
            </div>
          ) : null}

          {/* Sơ đồ máy trạm (task ws-map): ADMIN vẽ, mọi nhân viên xem ở trang Máy trạm → Biểu tượng. Lưu riêng (POST /workstations/map). */}
          {section === 'wsmap' ? <WorkstationMapEditor isAdmin={isAdmin} /> : null}

          {section === 'security' ? (
            <div className="settings-security">
              {securityError ? <InlineAlert tone="danger">{securityError}</InlineAlert> : null}
              {securityResult ? <InlineAlert tone="success">{securityResult}</InlineAlert> : null}

              <div className="settings-section settings-section--compact">
                <header>
                  <h2>Tài khoản quản trị</h2>
                  <p>Đổi tên đăng nhập và mật khẩu ADMIN. Hai tài khoản độc lập, lưu riêng.</p>
                </header>
                <div className="settings-split">
                  <form id="setting-admin-account" className="settings-subform" onSubmit={requestAdminPasswordChange}>
                    <div>
                      <h3 className="settings-group__title">ADMIN phần mềm</h3>
                      <p className="settings-group__hint">
                        Đổi cho đúng ADMIN trong phiên hiện tại. Chỉ đổi mật khẩu thì giữ nguyên tên đăng nhập.
                      </p>
                    </div>
                    <div className="settings-grid">
                      <label className="ds-field">
                        <span className="ds-field__label">Mật khẩu hiện tại</span>
                        <input className="ds-input" type="password" autoComplete="current-password" value={oldPassword} required onChange={(event) => setOldPassword(event.target.value)} />
                      </label>
                      <label className="ds-field">
                        <span className="ds-field__label">Tên đăng nhập mới</span>
                        <input className="ds-input" value={newAdminUsername} maxLength={32} required onChange={(event) => setNewAdminUsername(event.target.value)} />
                      </label>
                      <div className="settings-grid settings-grid--2">
                        <label className="ds-field">
                          <span className="ds-field__label">Mật khẩu mới</span>
                          <input className="ds-input" type="password" autoComplete="new-password" value={newAdminPassword} maxLength={32} required onChange={(event) => setNewAdminPassword(event.target.value)} />
                        </label>
                        <label className="ds-field">
                          <span className="ds-field__label">Nhập lại mật khẩu mới</span>
                          <input className="ds-input" type="password" autoComplete="new-password" value={confirmAdminPassword} maxLength={32} required onChange={(event) => setConfirmAdminPassword(event.target.value)} />
                        </label>
                      </div>
                    </div>
                    <div className="settings-subform__actions">
                      <Button type="submit" variant="primary">Kiểm tra và đổi tài khoản</Button>
                    </div>
                  </form>

                  <form id="setting-ws-admin-account" className="settings-subform" onSubmit={requestWorkstationPasswordChange}>
                    <div>
                      <h3 className="settings-group__title">ADMIN máy trạm</h3>
                      <p className="settings-group__hint">
                        Mở quyền ADMIN trên client máy trạm, không phải tài khoản Windows.{' '}
                        <strong>Lưu ý:</strong> khi lưu, máy chủ phát thông tin đăng nhập mới tới mọi client đang hoạt động.
                      </p>
                    </div>
                    <div className="settings-grid">
                      <label className="ds-field">
                        <span className="ds-field__label">Tên ADMIN máy trạm mới</span>
                        <input className="ds-input" value={wsAdminUsername} maxLength={32} required onChange={(event) => setWsAdminUsername(event.target.value)} />
                      </label>
                      <div className="settings-grid settings-grid--2">
                        <label className="ds-field">
                          <span className="ds-field__label">Mật khẩu mới</span>
                          <input className="ds-input" type="password" autoComplete="new-password" value={wsAdminPassword} maxLength={32} required onChange={(event) => setWsAdminPassword(event.target.value)} />
                        </label>
                        <label className="ds-field">
                          <span className="ds-field__label">Nhập lại mật khẩu mới</span>
                          <input className="ds-input" type="password" autoComplete="new-password" value={confirmWsAdminPassword} maxLength={32} required onChange={(event) => setConfirmWsAdminPassword(event.target.value)} />
                        </label>
                      </div>
                    </div>
                    <div className="settings-subform__actions">
                      <Button type="submit" variant="danger">Đổi tài khoản máy trạm</Button>
                    </div>
                  </form>
                </div>
              </div>

              {retentionQuery.data ? (
                <form className="settings-section settings-section--compact" onSubmit={saveRetention}>
                  <header>
                    <h2>Lưu trữ nhật ký</h2>
                    <p>
                      Thời gian giữ từng loại nhật ký trước khi máy chủ tự dọn. Đặt 0 để tắt dọn tự động; giảm thời gian
                      giữ có thể làm dữ liệu cũ bị xóa ở đợt dọn tiếp theo.
                    </p>
                  </header>
                  {retentionError ? <InlineAlert tone="danger">{retentionError}</InlineAlert> : null}
                  <div className="settings-retention-groups">
                    {RETENTION_GROUPS.map((group, groupIndex) => (
                      <section
                        key={group.title}
                        id={groupIndex === 0 ? 'setting-retention' : undefined}
                        className="settings-group"
                        aria-labelledby={`settings-retention-group-${groupIndex}`}
                      >
                        <h3 id={`settings-retention-group-${groupIndex}`} className="settings-group__title">{group.title}</h3>
                        <div className="settings-retention">
                          {group.keys.map((key) => {
                            const field = RETENTION_FIELDS.find((item) => item.key === key)
                            if (!field) return null
                            return (
                              <label key={field.key} className="settings-retention__row">
                                <span>{field.label}</span>
                                <span className="settings-retention__control">
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
                                  <small>{field.hint}</small>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                  <footer>
                    <Button type="submit" variant="primary" loading={retentionMutation.isPending}>
                      Lưu thời gian lưu trữ
                    </Button>
                  </footer>
                </form>
              ) : null}
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

      <ClientSystemFunctionDialog
        open={systemFunctionsOpen}
        canManage={isAdmin}
        onClose={() => setSystemFunctionsOpen(false)}
      />

      <ScheduledShutdownDialog
        open={shutdownScheduleOpen}
        canManage={hasRight(RIGHT_SHUTDOWN_ALL)}
        onClose={() => setShutdownScheduleOpen(false)}
      />
    </section>
  )
}
