import {  useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppWindow,
  ArrowCircleUp,
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Check,
  CheckCircle,
  ChartBarHorizontal,
  Circuitry,
  ChartDonut,
  ChatCircleText,
  Clock,
  Cpu,
  CurrencyCircleDollar,
  Desktop,
  ForkKnife,
  Gift,
  GraphicsCard,
  HandCoins,
  HourglassMedium,
  Info,
  Lock,
  MagnifyingGlass,
  Money,
  PencilSimple,
  Power,
  Receipt,
  SignIn,
  Thermometer,
  TrashSimple,
  UserCircle,
  UserGear,
  UserPlus,
  Wallet,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { getMachineGroups } from '../../api/machine-groups'
import { describeApiErrorCode } from '../../lib/apiErrorText'
import { getPaymentWaitLogs, type PaymentWaitLog } from '../../api/logs'
import { getUsers, usersApi, type UserAccount } from '../../api/users'
import { anonymsApi, type AnonymousDetailPayload } from '../../api/anonyms'
import { maskIdCard, validateAnonymousDetail } from '../anonyms/anonymModel'
import {
  adminLoginWorkstations,
  bulkChangeWorkstationGroup,
  closeAppWorkstations,
  continuePaymentWait,
  changeSessionToPrepaid,
  changeWorkstationPc,
  deactivateWorkstations,
  getRegisteredWorkstations,
  loginWorkstationPayLater,
  loginWorkstationPrepaid,
  logoutWorkstations,
  payoutPrepaidWorkstation,
  payoutPaymentWait,
  payoutWorkstation,
  payDebitWorkstation,
  restartWorkstations,
  sendWorkstationMessage,
  shutdownWorkstations,
  suspendWorkstation,
  updateWorkstationNote,
  updateWorkstationsVersion,
  wakeupWorkstations,
  getWorkstationHardware,
  getWorkstationsRuntime,
  type WorkstationRuntime,
  type WsControlResult,
} from '../../api/workstations'
import {
  closeAllWorkstationApps,
  closeWorkstationApp,
  getWorkstationApps,
  type WorkstationApp,
} from '../../api/workstationRealtime'
import { Select,
  Button,
  ConfirmAction,
  Dialog,
  Drawer,
  IconButton,
  InlineAlert,
  MoneyInput,
  PageHeader,
  PollingStatus,
  StateView,
  StatusBadge,
  type StatusTone,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { useAuthStore } from '../../store/auth'
import { useOrderQueueStore } from '../../store/orderQueue'
import { pushToast } from '../../store/toast'
import { useWsStatusStore } from '../../store/wsStatus'
import { DepositMethodSelector } from '../payments/DepositMethodSelector'
import { DepositAmountPanel } from '../payments/DepositAmountPanel'
import { DepositQrFlow } from '../payments/DepositQrFlow'
import { useDepositReceiptPrint } from '../payments/useDepositReceiptPrint'
import {
  canSubmitDeposit,
  getDepositMethodOption,
  toDepositApiPaymentMethod,
  type DepositMethod,
} from '../payments/depositModel'
import {
  WorkstationVirtualList,
  COLUMNS,
  COLUMN_STORAGE_KEY,
  getInitialOptionalColumns,
  type ColumnId,
} from './WorkstationVirtualList'
import {
  WORKSTATION_FLAGS,
  WORKSTATION_STATUS,
  formatDuration,
  formatMoney,
  formatStartedAt,
  getWorkstationFlags,
  getWorkstationStatus,
  hasDebt,
  interpolateSession,
  matchesWorkstationFilter,
  sessionLabel,
  type WorkstationFilter,
} from './workstationModel'
import { PrintTicketDialog } from '../orders/PrintTicketDialog'
import { StaffOrderDialog } from '../orders/StaffOrderDialog'
import { CallBellIcon } from './CallBellIcon'
import { InspectorGroup } from './InspectorGroup'
import { MachineOrderList, MachineOrdersCounts, useMachineOrders } from './MachineOrdersPanel'
import { machineOrdersWaitingTotal } from './machineOrdersModel'
import { HardwareBlock, hardwareErrorsTitle, num, tempTone, WinLicenseBadge, WinLicenseCell } from './MachineTechExtras'
import './workstations.css'

const RIGHTS = {
  ADMIN_LOGIN: 15,
  RESTART_ALL: 121,
  SHUTDOWN_ALL: 131,
  CLOSE_ALL_APPS: 141,
  MODIFY_MONEY: 9222,
  INPUT_NEGATIVE_MONEY: 26,
  CHANGE_GROUP: 9414,
  SUSPEND_MACHINE: 94311,
  // RBAC shadow o backend (INT_RBAC_ENFORCE=0, PaymentHandlers.cpp:6366/6553) -- khong chan
  // cung tren may chu, giu de hien thi "Thieu quyen" nhat quan voi cac nut khac.
  POSTPAID_LOGIN: 101,
  PREPAID_LOGIN: 102,
  // R_DEBIT_MONEY_ALLOW_DEBIT (define.h:50) -- RBAC shadow cho /user/credit (PaymentHandlers.cpp:3724).
  CREDIT_MONEY: 242,
} as const

// Mau chu khop voi mau badge (.ds-badge--*, controls.css) -- dung de to mau icon/gia tri
// nhiet do o dong tom tat nhom "Phan cung" (khong boc badge vi can gon 1 dong, nhieu muc).
const TONE_TEXT_COLOR: Record<StatusTone, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger-text)',
  info: 'var(--color-info)',
  neutral: 'var(--color-text-muted)',
}

// UserGroupTypeCode (api/user-groups.ts): 1=anonym 2=member 3=admin 4=staff 5=combo
const USER_GROUP_TYPE = {
  anonym: 1,
  member: 2,
  combo: 5,
} as const

// Phan loai giong cac con so o the thong ke "Su dung" (counts.member/anonym/combo/admin):
// ONLINE + userId===0 la admin, con lai theo userGroupType. Mau o .ws-user-badge--* dung
// chung bien voi cham .ws-summary__dot--* (workstations.css).
type UserKind = 'member' | 'anonym' | 'combo' | 'admin'

const USER_KIND_LABEL: Record<UserKind, string> = {
  member: 'Hội viên',
  anonym: 'Vãng lai',
  combo: 'Combo',
  admin: 'Admin',
}

function getUserKind(machine: WorkstationRuntime): UserKind | null {
  if (machine.status === WORKSTATION_STATUS.ONLINE && machine.userId === 0) return 'admin'
  if (machine.userGroupType === USER_GROUP_TYPE.member) return 'member'
  if (machine.userGroupType === USER_GROUP_TYPE.anonym) return 'anonym'
  if (machine.userGroupType === USER_GROUP_TYPE.combo) return 'combo'
  return null
}

type CommandKind =
  | 'logout'
  | 'restart'
  | 'shutdown'
  | 'closeApp'
  | 'adminLogin'
  | 'update'
  | 'wakeup'

// Icon nut trong drawer chi tiet may. Truyen `icon` tuong minh vi Button suy icon
// theo nhan (inferActionIcon) -- "Khoi dong lai" va "Tat may" deu ra cung 1 icon Power,
// "Cap nhat" ra icon luu dia.
const ICON = { size: 18, weight: 'bold' as const, 'aria-hidden': true }

const COMMAND_ICONS: Record<CommandKind, ReactNode> = {
  logout: <Lock {...ICON} />,
  restart: <ArrowsClockwise {...ICON} />,
  shutdown: <Power {...ICON} />,
  closeApp: <XCircle {...ICON} />,
  adminLogin: <UserGear {...ICON} />,
  update: <ArrowCircleUp {...ICON} />,
  wakeup: <Power {...ICON} />,
}

type CommandRequest = {
  kind: CommandKind
  hostNames: string[]
}

type CommandDefinition = {
  label: string
  confirmLabel: string
  description: string
  right?: number
  adminOnly?: boolean
  danger?: boolean
  availableOnly?: boolean
  offlineOnly?: boolean
  blockAnonymPayLater?: boolean
  requiresVerNew?: boolean
  /** Chan khi may dang Sap sang (chua co phien) -- parity WorkstationList.cpp:1804
      (IDR_LOGOUT mac dinh GRAYED, chi nhanh ONLINE moi bat lai, nhanh AVAILABLE khong). */
  blockAvailable?: boolean
}

const COMMANDS: Record<CommandKind, CommandDefinition> = {
  logout: {
    label: 'Đăng xuất',
    confirmLabel: 'Đăng xuất máy',
    description: 'Kết thúc phiên đăng nhập trên các máy đã chọn.',
    danger: true,
    // Parity CWorkstationList::OnMenuWorkstation -- IDR_LOGOUT chi duoc enable cho
    // ANONYM+prepaid hoac Member/Staff/Admin (xem WorkstationList.cpp:1901-1937).
    // Vang lai tra sau PHAI Tinh tien / Cho tinh tien, khong duoc dang xuat thang.
    blockAnonymPayLater: true,
    // Parity WorkstationList.cpp:1804 -- may Sap sang (chua co phien) khong co gi de
    // dang xuat, IDR_LOGOUT mac dinh GRAYED va khong duoc bat lai o nhanh AVAILABLE.
    blockAvailable: true,
  },
  restart: {
    label: 'Khởi động lại',
    confirmLabel: 'Khởi động lại',
    description: 'Gửi lệnh khởi động lại tới từng máy đang kết nối.',
    right: RIGHTS.RESTART_ALL,
    danger: true,
  },
  shutdown: {
    label: 'Tắt máy',
    confirmLabel: 'Tắt máy',
    description: 'Gửi lệnh tắt tới từng máy đang kết nối.',
    right: RIGHTS.SHUTDOWN_ALL,
    danger: true,
  },
  closeApp: {
    label: 'Đóng ứng dụng',
    confirmLabel: 'Đóng ứng dụng',
    description: 'Đóng toàn bộ ứng dụng trên các máy đã chọn.',
    right: RIGHTS.CLOSE_ALL_APPS,
    danger: true,
  },
  adminLogin: {
    label: 'Đăng nhập ADMIN',
    confirmLabel: 'Đăng nhập ADMIN',
    description: 'Mở phiên ADMIN trên máy đang ở trạng thái Sẵn sàng.',
    right: RIGHTS.ADMIN_LOGIN,
    availableOnly: true,
  },
  update: {
    label: 'Nâng cấp',
    confirmLabel: 'Gửi lệnh nâng cấp',
    description: 'Yêu cầu client trên các máy đã chọn cập nhật phiên bản.',
    adminOnly: true,
    requiresVerNew: true,
  },
  wakeup: {
    label: 'Mở máy trạm',
    confirmLabel: 'Mở máy trạm',
    description: 'Gửi gói Wake-on-LAN đánh thức các máy đang tắt/mất kết nối. Chỉ dành cho quản trị viên.',
    adminOnly: true,
    offlineOnly: true,
  },
}

type MoneyAction =
  | 'payout'
  | 'payoutPrepaid'
  | 'payDebit'
  | 'suspend'
  | 'deposit'
  | 'giveFree'
  | 'credit'

type ChangePcMode = 'change' | 'swap'

function executeCommand({ kind, hostNames }: CommandRequest) {
  switch (kind) {
    case 'logout':
      return logoutWorkstations({ hostNames })
    case 'restart':
      return restartWorkstations({ hostNames })
    case 'shutdown':
      return shutdownWorkstations({ hostNames })
    case 'closeApp':
      return closeAppWorkstations({ hostNames })
    case 'adminLogin':
      return adminLoginWorkstations({ hostNames })
    case 'update':
      return updateWorkstationsVersion({ hostNames })
    case 'wakeup':
      return wakeupWorkstations({ hostNames })
  }
}

function commandDisabledReason(
  definition: CommandDefinition,
  machines: WorkstationRuntime[],
  hasRight: (right: number) => boolean,
  isAdmin: boolean,
) {
  if (machines.length === 0) return 'Hãy chọn ít nhất một máy'
  if (definition.adminOnly && !isAdmin) return 'Chỉ quản trị viên được thực hiện'
  if (definition.right && !hasRight(definition.right)) return `Thiếu quyền ${definition.right}`
  if (
    definition.availableOnly &&
    machines.some((machine) => machine.status !== WORKSTATION_STATUS.AVAILABLE)
  ) {
    return 'Chỉ áp dụng cho máy Sẵn sàng'
  }
  if (
    definition.offlineOnly &&
    machines.some(
      (machine) =>
        machine.status !== WORKSTATION_STATUS.DISCONNECT &&
        machine.status !== WORKSTATION_STATUS.WARNING,
    )
  ) {
    return 'Chỉ áp dụng cho máy đang tắt/mất kết nối'
  }
  if (
    definition.blockAvailable &&
    machines.some((machine) => machine.status === WORKSTATION_STATUS.AVAILABLE)
  ) {
    return 'Máy đang Sẵn sàng, không có phiên để đăng xuất'
  }
  if (
    definition.blockAnonymPayLater &&
    machines.some(
      (machine) =>
        machine.userGroupType === USER_GROUP_TYPE.anonym && machine.session && !machine.session.prepaid,
    )
  ) {
    return 'Khách vãng lai trả sau: hãy Tính tiền hoặc đưa vào Chờ tính tiền thay vì đăng xuất'
  }
  if (definition.requiresVerNew && machines.some((machine) => !machine.verNew)) {
    return 'Máy trạm đã ở phiên bản mới nhất'
  }
  return ''
}

function getExactUser(items: UserAccount[] | undefined, machine: WorkstationRuntime | null) {
  if (!items || !machine) return null
  return (
    items.find((user) => user.userId === machine.userId) ??
    items.find((user) => user.userName === machine.userName) ??
    null
  )
}

function resultMessage(results: WsControlResult[]) {
  const succeeded = results.filter((item) => item.ok).length
  return `${succeeded}/${results.length} máy nhận lệnh thành công`
}

const GROUP_CHART_ORIENTATION_STORAGE_KEY = 'fnet.workstations.group-chart-orientation.v2'

function getInitialGroupChartOrientation(): 'donut' | 'row' {
  try {
    const stored = window.localStorage.getItem(GROUP_CHART_ORIENTATION_STORAGE_KEY)
    return stored === 'donut' ? 'donut' : 'row'
  } catch {
    return 'row'
  }
}

const DONUT_RADIUS = 15.9155
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

export function WorkstationWorkspace() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const connected = useWsStatusStore((state) => state.connected)
  const hasRight = useAuthStore((state) => state.hasRight)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const staffName = useAuthStore((state) => state.staffName)
  const setOrderHost = useOrderQueueStore((state) => state.setHostName)
  const setOrderCustomerName = useOrderQueueStore((state) => state.setCustomerNameFilter)

  const snapshotQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const registeredQuery = useQuery({
    queryKey: ['workstations-registered'],
    queryFn: getRegisteredWorkstations,
    staleTime: 60_000, // danh sach DB doi cham, khong can poll nhu runtime
  })
  const groupsQuery = useQuery({
    queryKey: ['machine-groups'],
    queryFn: getMachineGroups,
  })
  const paymentWaitQuery = useQuery({
    queryKey: ['payment-wait'],
    queryFn: getPaymentWaitLogs,
    refetchInterval: connected ? 30_000 : 10_000,
  })

  const snapshot = Array.isArray(snapshotQuery.data) ? null : snapshotQuery.data
  const allMachines = useMemo(() => snapshot?.items ?? [], [snapshot])
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<WorkstationFilter>('all')
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState(0)
  const [optionalColumns, setOptionalColumns] = useState(getInitialOptionalColumns)
  const [groupChartOrientation, setGroupChartOrientation] = useState<'donut' | 'row'>(getInitialGroupChartOrientation)
  const groupScrollRef = useRef<HTMLDivElement | null>(null)
  const [groupScrollState, setGroupScrollState] = useState({ canLeft: false, canRight: false })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inspectorHost, setInspectorHost] = useState<string | null>(null)
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [pendingCommand, setPendingCommand] = useState<CommandKind | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [targetGroupId, setTargetGroupId] = useState(0)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [note, setNote] = useState('')
  const [lockLogin, setLockLogin] = useState(false)
  const [showLockScreen, setShowLockScreen] = useState(false)
  const [moneyAction, setMoneyAction] = useState<MoneyAction | null>(null)
  const [moneyAmount, setMoneyAmount] = useState<number | null>(null)
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('cash')
  const [depositQrActive, setDepositQrActive] = useState(false)
  const [moneyNote, setMoneyNote] = useState('')
  const [paymentWaitOpen, setPaymentWaitOpen] = useState(false)
  const [wakeupOpen, setWakeupOpen] = useState(false)
  const [wakeupSearch, setWakeupSearch] = useState('')
  const [wakeupChecked, setWakeupChecked] = useState<Set<string>>(new Set())
  const [wakeupResults, setWakeupResults] = useState<WsControlResult[]>([])
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false)
  const [payoutWaitLog, setPayoutWaitLog] = useState<PaymentWaitLog | null>(null)
  const [continueWaitLog, setContinueWaitLog] = useState<PaymentWaitLog | null>(null)
  const [continueTarget, setContinueTarget] = useState('')
  const [changePcOpen, setChangePcOpen] = useState(false)
  const [changePcMode, setChangePcMode] = useState<ChangePcMode>('change')
  const [changePcTarget, setChangePcTarget] = useState('')
  const [prepaidOpen, setPrepaidOpen] = useState(false)
  const [prepaidAmount, setPrepaidAmount] = useState<number | null>(20_000)
  const [anonymLoginOpen, setAnonymLoginOpen] = useState<'prepaid' | 'payLater' | null>(null)
  const [loginPriceId, setLoginPriceId] = useState<number | ''>('')
  const [loginPriceAppRentId, setLoginPriceAppRentId] = useState<number | ''>('')
  const [loginChargeMoney, setLoginChargeMoney] = useState<number | null>(20_000)
  const [messageDialogOpen, setMessageDialogOpen] = useState(false)
  const [messageTargets, setMessageTargets] = useState<string[]>([])
  const [noteTargets, setNoteTargets] = useState<string[]>([])
  const [messageText, setMessageText] = useState('')
  const [appsDialogOpen, setAppsDialogOpen] = useState(false)
  const [appsList, setAppsList] = useState<WorkstationApp[] | null>(null)
  const [appsError, setAppsError] = useState<string | null>(null)
  const [anonymInfoOpen, setAnonymInfoOpen] = useState(false)
  const [staffOrderOpen, setStaffOrderOpen] = useState(false)
  const [printDetailIds, setPrintDetailIds] = useState<number[] | null>(null)
  const [anonymDraft, setAnonymDraft] = useState<AnonymousDetailPayload>({ name: '', idCard: '', address: '' })
  const [anonymDraftError, setAnonymDraftError] = useState<string | null>(null)
  const [anonymSearch, setAnonymSearch] = useState('')
  const moneyIntent = useIdempotentIntent('workstation-workspace-money')
  const depositPrint = useDepositReceiptPrint()
  const paymentWaitPayoutIntent = useIdempotentIntent('payment-wait-payout')
  const paymentWaitContinueIntent = useIdempotentIntent('payment-wait-continue')
  const changePcIntent = useIdempotentIntent('workstation-change-pc')
  const prepaidIntent = useIdempotentIntent('workstation-change-prepaid')
  const anonymLoginIntent = useIdempotentIntent('workstation-anonym-login')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...optionalColumns]))
  }, [optionalColumns])

  useEffect(() => {
    window.localStorage.setItem(GROUP_CHART_ORIENTATION_STORAGE_KEY, groupChartOrientation)
  }, [groupChartOrientation])

  const toggleColumn = (id: ColumnId) => {
    setOptionalColumns((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleColumns = useMemo(
    () => COLUMNS.filter((column) => column.required || optionalColumns.has(column.id)),
    [optionalColumns],
  )

  const elapsedSeconds =
    snapshotQuery.dataUpdatedAt > 0 ? (now - snapshotQuery.dataUpdatedAt) / 1_000 : 0

  const filteredMachines = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    return allMachines
      .filter((machine) => matchesWorkstationFilter(machine, filter))
      .filter((machine) => groupId === 0 || machine.machineGroupId === groupId)
      .filter((machine) => {
        if (!needle) return true
        return [machine.hostName, machine.ip, machine.userName, machine.note]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('vi').includes(needle))
      })
      .sort((left, right) =>
        left.hostName.localeCompare(right.hostName, 'vi', { numeric: true }),
      )
  }, [allMachines, filter, groupId, search])
  const hasActiveFilter = filter !== 'all' || groupId !== 0 || search.trim() !== ''

  const selectedMachines = useMemo(
    () => allMachines.filter((machine) => selected.has(machine.hostName)),
    [allMachines, selected],
  )
  const inspectedMachine =
    allMachines.find((machine) => machine.hostName === inspectorHost) ?? null
  const status = inspectedMachine ? getWorkstationStatus(inspectedMachine) : null
  const flags = inspectedMachine ? getWorkstationFlags(inspectedMachine) : []
  const userKind = inspectedMachine ? getUserKind(inspectedMachine) : null
  // ADMIN login dung userId=0 (WorkstationHandlers.cpp:657) -- khong phai khach hang
  // tra tien, nen khong co Tinh tien/Chuyen may/Dich vu (parity WorkstationList.cpp
  // EnableMenuItem IDR_PAYOUT/IDR_CHANGE_WS/IDR_SERVICE_ORDER chi cho session khach that).
  const isAdminSession = Boolean(
    inspectedMachine &&
      inspectedMachine.status === WORKSTATION_STATUS.ONLINE &&
      inspectedMachine.userId === 0,
  )
  const clock = inspectedMachine
    ? interpolateSession(inspectedMachine, elapsedSeconds)
    : { used: null, remaining: null }
  // "Tam dung" (badge flags.ts:147) -- khi client pause, khoa toan bo thao tac tren may
  // nay tru Bat may tu xa (thao tac duy nhat hop ly khi khong ro trang thai client that).
  const isPaused = Boolean(
    inspectedMachine && (inspectedMachine.flagMask & WORKSTATION_FLAGS.CLIENT_PAUSE) !== 0,
  )

  useEffect(() => {
    setNoteExpanded(false)
  }, [inspectorHost])

  const userQuery = useQuery({
    queryKey: ['workstation-user', inspectedMachine?.userId, inspectedMachine?.userName],
    queryFn: () => getUsers('member', 20, 0, inspectedMachine?.userName ?? ''),
    enabled: Boolean(inspectedMachine?.userId && inspectedMachine?.userName),
  })
  const exactUser = getExactUser(userQuery.data?.items, inspectedMachine)
  const assignedAnonymId = inspectedMachine?.session?.anonymId ?? null
  const assignedAnonymQuery = useQuery({
    queryKey: ['anonym-detail', assignedAnonymId],
    queryFn: () => anonymsApi.getById(assignedAnonymId as number),
    enabled: Boolean(assignedAnonymId),
  })
  // Query tach khoi HardwareBlock (chi mount luc nhom "Phan cung" mo rong) -- can o day
  // de hien tom tat nhiet do CPU/GPU ngay ca khi nhom dang thu gon. Cung queryKey nen
  // React Query dung chung cache, khong goi API 2 lan.
  const hardwareQuery = useQuery({
    queryKey: ['workstation-hardware', inspectedMachine?.hostName],
    queryFn: () => getWorkstationHardware(inspectedMachine!.hostName),
    enabled: Boolean(inspectedMachine),
    staleTime: 15_000,
  })
  const hw = hardwareQuery.data?.hardware ?? null
  // Phan hwm.exe lay hong o lan gui gan nhat -> icon canh bao o dong tom tat (thay ca khi thu gon).
  const hwErrorsTitle = hardwareErrorsTitle(hw?.errors)
  const {
    view: machineOrders,
    isLoading: machineOrdersLoading,
    error: machineOrdersError,
  } = useMachineOrders(
    inspectedMachine?.hostName ?? null,
    Boolean(inspectedMachine?.session) && !isAdminSession,
    connected,
  )
  const anonymSearchQuery = useQuery({
    queryKey: ['anonyms', 'search', anonymSearch],
    queryFn: () => anonymsApi.getList(anonymSearch || undefined),
    enabled: anonymInfoOpen && !assignedAnonymId,
  })
  const loginOptionsQuery = useQuery({
    queryKey: ['anonym-payafter-options', inspectedMachine?.machineGroupId, loginPriceId || undefined],
    queryFn: () => anonymsApi.getPayAfterOptions(inspectedMachine!.machineGroupId, loginPriceId || undefined),
    enabled: Boolean(inspectedMachine) && anonymLoginOpen !== null,
  })
  useEffect(() => {
    if (anonymLoginOpen && loginPriceId === '' && loginOptionsQuery.data) {
      setLoginPriceId(loginOptionsQuery.data.selectedPriceId)
    }
  }, [anonymLoginOpen, loginPriceId, loginOptionsQuery.data])
  const availableMachines = useMemo(
    () =>
      allMachines.filter(
        (machine) => machine.status === WORKSTATION_STATUS.AVAILABLE,
      ),
    [allMachines],
  )
  const changePcTargets = useMemo(() => {
    if (!inspectedMachine) return []
    return allMachines.filter((machine) => {
      if (machine.hostName === inspectedMachine.hostName) return false
      return changePcMode === 'change'
        ? machine.status === WORKSTATION_STATUS.AVAILABLE
        : machine.status === WORKSTATION_STATUS.ONLINE
    })
  }, [allMachines, changePcMode, inspectedMachine])

  const commandMutation = useMutation({
    mutationFn: async (request: CommandRequest) => {
      const response = await executeCommand(request)
      return response.results
    },
    onSuccess: (results) => {
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      setPendingCommand(null)
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  // Mutation RIENG cho drawer "Bat may tu xa" -- KHONG tai dung commandMutation/
  // executeCommand(kind:'wakeup'): duong do di qua commandDisabledReason nhan
  // WorkstationRuntime (co status tu RAM), con may trong drawer nay co the chua
  // tung connect (khong co object RAM), kieu RegisteredWorkstation khong khop.
  const wakeupDrawerMutation = useMutation({
    mutationFn: (hostNames: string[]) => wakeupWorkstations({ hostNames }),
    onSuccess: ({ results }) => {
      setWakeupResults(results)
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (hostNames: string[]) => deactivateWorkstations({ hostNames }),
    onSuccess: ({ affectedRows, skipped }) => {
      setDeactivateConfirmOpen(false)
      setWakeupChecked(new Set())
      pushToast(
        skipped.length > 0
          ? `Đã vô hiệu hoá ${affectedRows} máy. Bỏ qua ${skipped.length} máy đang online: ${skipped.map((s) => s.hostName).join(', ')}.`
          : `Đã vô hiệu hoá ${affectedRows} máy.`,
        skipped.length > 0 ? 'info' : 'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['workstations-registered'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const groupMutation = useMutation({
    mutationFn: () =>
      bulkChangeWorkstationGroup({
        hostNames: selectedMachines.map((machine) => machine.hostName),
        machineGroupId: targetGroupId,
      }),
    onSuccess: ({ results }) => {
      setGroupDialogOpen(false)
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const noteMutation = useMutation({
    mutationFn: () =>
      updateWorkstationNote({
        hostNames: noteTargets,
        note: note.trim(),
        lockLogin,
        showLockScreen,
      }),
    onSuccess: ({ results, fn1 }) => {
      setNoteDialogOpen(false)
      if (!fn1 && (lockLogin || showLockScreen)) {
        pushToast('Ghi chú đã lưu; khóa màn hình không bật vì máy chủ chưa có FN1.', 'info')
      } else {
        pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      }
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const messageMutation = useMutation({
    mutationFn: () => sendWorkstationMessage({ hostNames: messageTargets, message: messageText.trim() }),
    onSuccess: ({ results }) => {
      setMessageDialogOpen(false)
      setMessageText('')
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const appsQueryMutation = useMutation({
    mutationFn: (hostName: string) => getWorkstationApps(hostName),
    onSuccess: (apps) => {
      setAppsList(apps)
      setAppsError(null)
    },
    onError: (error) => {
      setAppsError(error.message)
      setAppsList(null)
    },
  })

  const closeAppMutation = useMutation({
    mutationFn: (payload: { app: WorkstationApp } | { all: true }) => {
      if (!inspectedMachine) throw new Error('Chưa chọn máy')
      return 'all' in payload
        ? closeAllWorkstationApps(inspectedMachine.hostName)
        : closeWorkstationApp(inspectedMachine.hostName, payload.app)
    },
    onSuccess: () => {
      pushToast('Đã gửi lệnh đóng ứng dụng.', 'success')
      if (inspectedMachine) appsQueryMutation.mutate(inspectedMachine.hostName)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const moneyMutation = useMutation({
    mutationFn: async () => {
      if (!moneyAction || !inspectedMachine) throw new Error('Chưa chọn giao dịch')
      const base = {
        action: moneyAction,
        hostName: inspectedMachine.hostName,
        userId: inspectedMachine.userId,
        amount: moneyAmount,
        depositMethod: moneyAction === 'deposit' ? depositMethod : undefined,
        note: moneyNote.trim(),
      }
      const idem = moneyIntent.getKey(fingerprintIntent(base))
      switch (moneyAction) {
        case 'payout':
          return payoutWorkstation({
            machine: inspectedMachine.hostName,
            note: moneyNote.trim() || undefined,
            idem,
          })
        case 'payoutPrepaid':
          return payoutPrepaidWorkstation({
            userId: inspectedMachine.userId,
            note: moneyNote.trim() || undefined,
            idem,
          })
        case 'payDebit':
          return payDebitWorkstation({
            userId: inspectedMachine.userId,
            machine: inspectedMachine.hostName,
            note: moneyNote.trim() || undefined,
            idem,
          })
        case 'suspend':
          return suspendWorkstation({
            hostName: inspectedMachine.hostName,
            note: moneyNote.trim() || undefined,
            idem,
          })
        case 'deposit':
          if (!exactUser || !moneyAmount) throw new Error('Số tiền nạp không hợp lệ')
          if (
            !canSubmitDeposit(
              depositMethod,
              moneyAmount,
              hasRight(RIGHTS.INPUT_NEGATIVE_MONEY),
            )
          ) {
            throw new Error(
              'Số tiền hoặc phương thức nạp không hợp lệ',
            )
          }
          return usersApi.deposit({
            userId: exactUser.userId,
            chargeMoney: moneyAmount,
            paymentMethod: toDepositApiPaymentMethod(depositMethod),
            idem,
          })
        case 'giveFree':
          if (!moneyAmount) throw new Error('Số tiền tặng không hợp lệ')
          return usersApi.giveFree({
            userId: inspectedMachine.userId,
            giveMoney: moneyAmount,
            idem,
          })
        case 'credit':
          if (!moneyAmount || moneyAmount <= 0) throw new Error('Số tiền cho mượn không hợp lệ')
          return usersApi.credit({
            userId: inspectedMachine.userId,
            borrowMoney: moneyAmount,
            idem,
          })
      }
    },
    onSuccess: () => {
      // In phiếu nạp (nếu bật) TRƯỚC khi state bị xoá. Tiền đã ghi — in lỗi không ảnh hưởng giao dịch.
      if (moneyAction === 'deposit' && exactUser) {
        depositPrint.print({
          username: exactUser.userName,
          amount: moneyAmount,
          method: depositMethod,
          machine: inspectedMachine?.hostName,
        })
      }
      moneyIntent.clearKey()
      setMoneyAction(null)
      setMoneyAmount(null)
      setDepositMethod('cash')
      setDepositQrActive(false)
      setMoneyNote('')
      pushToast('Giao dịch đã hoàn tất và dữ liệu đang được làm mới.', 'success')
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const paymentWaitPayoutMutation = useMutation({
    mutationFn: (log: PaymentWaitLog) =>
      payoutPaymentWait({
        paymentWaitIds: [log.id],
        idem: paymentWaitPayoutIntent.getKey(
          fingerprintIntent({
            paymentWaitIds: [log.id],
            transferUserId: 0,
          }),
        ),
      }),
    onSuccess: (response) => {
      paymentWaitPayoutIntent.clearKey()
      const duplicated = response.duplicatedCount
      pushToast(
        duplicated
          ? `Phiên đã được xử lý trước đó (${duplicated} giao dịch trùng).`
          : `Đã thu ${formatMoney(response.totalCollected)}.`,
        duplicated ? 'info' : 'success',
      )
      void invalidateMoneyQueries(queryClient)
      setPayoutWaitLog(null)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const paymentWaitContinueMutation = useMutation({
    mutationFn: () => {
      if (!continueWaitLog || !continueTarget) {
        throw new Error('Hãy chọn máy mới đang Sẵn sàng')
      }
      return continuePaymentWait({
        paymentWaitId: continueWaitLog.id,
        newHostName: continueTarget,
        idem: paymentWaitContinueIntent.getKey(
          fingerprintIntent({
            paymentWaitId: continueWaitLog.id,
            newHostName: continueTarget,
          }),
        ),
      })
    },
    onSuccess: () => {
      paymentWaitContinueIntent.clearKey()
      setContinueWaitLog(null)
      setContinueTarget('')
      pushToast('Đã chuyển phiên chờ sang máy mới.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['payment-wait'] })
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const changePcMutation = useMutation({
    mutationFn: () => {
      if (!inspectedMachine || !changePcTarget) {
        throw new Error('Hãy chọn máy đích')
      }
      return changeWorkstationPc({
        oldMachine: inspectedMachine.hostName,
        newMachine: changePcTarget,
        mode: changePcMode,
        idem: changePcIntent.getKey(
          fingerprintIntent({
            oldMachine: inspectedMachine.hostName,
            newMachine: changePcTarget,
            mode: changePcMode,
          }),
        ),
      })
    },
    onSuccess: () => {
      changePcIntent.clearKey()
      setChangePcOpen(false)
      setChangePcTarget('')
      pushToast(
        changePcMode === 'change' ? 'Đã chuyển phiên sang máy mới.' : 'Đã hoán đổi hai máy.',
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const prepaidMutation = useMutation({
    mutationFn: () => {
      if (!inspectedMachine || !prepaidAmount || prepaidAmount <= 0) {
        throw new Error('Số tiền trả trước không hợp lệ')
      }
      return changeSessionToPrepaid({
        machine: inspectedMachine.hostName,
        chargeMoney: prepaidAmount,
        idem: prepaidIntent.getKey(
          fingerprintIntent({
            machine: inspectedMachine.hostName,
            chargeMoney: prepaidAmount,
          }),
        ),
      })
    },
    onSuccess: () => {
      prepaidIntent.clearKey()
      setPrepaidOpen(false)
      pushToast('Đã chuyển phiên sang trả trước.', 'success')
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const anonymLoginMutation = useMutation({
    mutationFn: () => {
      if (!inspectedMachine) throw new Error('Chưa chọn máy')
      if (!loginPriceId) throw new Error('Chưa chọn nhóm giá')
      const priceAppRentId = loginPriceAppRentId || undefined
      if (anonymLoginOpen === 'prepaid') {
        if (!loginChargeMoney || loginChargeMoney <= 0) throw new Error('Số tiền trả trước không hợp lệ')
        return loginWorkstationPrepaid({
          hostName: inspectedMachine.hostName,
          priceId: loginPriceId,
          priceAppRentId,
          chargeMoney: loginChargeMoney,
          idem: anonymLoginIntent.getKey(
            fingerprintIntent({
              hostName: inspectedMachine.hostName,
              priceId: loginPriceId,
              priceAppRentId,
              chargeMoney: loginChargeMoney,
            }),
          ),
        })
      }
      return loginWorkstationPayLater({
        hostName: inspectedMachine.hostName,
        priceId: loginPriceId,
        priceAppRentId,
        idem: anonymLoginIntent.getKey(
          fingerprintIntent({ hostName: inspectedMachine.hostName, priceId: loginPriceId, priceAppRentId }),
        ),
      })
    },
    onSuccess: () => {
      anonymLoginIntent.clearKey()
      pushToast(
        anonymLoginOpen === 'prepaid' ? 'Đã đăng nhập khách trả tiền trước.' : 'Đã đăng nhập khách trả tiền sau.',
        'success',
      )
      setAnonymLoginOpen(null)
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  // Sua thong tin CCCD/ten/dia chi cua ban ghi AnonymousTb DANG GAN cho phien nay
  // (parity CAnonyInfoDlg::OnBnClickedBtnUpdate khi m_ulAnonymId > 0).
  const anonymUpdateMutation = useMutation({
    mutationFn: () => {
      const validation = validateAnonymousDetail(anonymDraft)
      if (validation) throw new Error(validation)
      if (!assignedAnonymId) throw new Error('Không xác định được hồ sơ cần sửa')
      return anonymsApi.update({
        id: assignedAnonymId,
        name: anonymDraft.name.trim(),
        idCard: anonymDraft.idCard.trim(),
        address: anonymDraft.address.trim(),
      })
    },
    onSuccess: () => {
      pushToast('Đã cập nhật thông tin khách vãng lai.', 'success')
      setAnonymInfoOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['anonym-detail', assignedAnonymId] })
      void queryClient.invalidateQueries({ queryKey: ['anonyms'] })
    },
    onError: (error: Error) => setAnonymDraftError(error.message),
  })

  // Gan 1 ho so da co san vao phien dang mo (parity CAnonyInfoDlg chon tu danh sach).
  const anonymAssignMutation = useMutation({
    mutationFn: (anonymId: number) => {
      if (!inspectedMachine) throw new Error('Chưa chọn máy')
      return anonymsApi.assignSession({ hostName: inspectedMachine.hostName, anonymId })
    },
    onSuccess: () => {
      pushToast('Đã gán thông tin khách vãng lai.', 'success')
      setAnonymInfoOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  // Tao moi ho so roi gan luon (parity CAnonyInfoDlg khi CCCD chua ton tai trong AnonymousTb).
  const anonymCreateAssignMutation = useMutation({
    mutationFn: async () => {
      const validation = validateAnonymousDetail(anonymDraft)
      if (validation) throw new Error(validation)
      if (!inspectedMachine) throw new Error('Chưa chọn máy')
      const created = await anonymsApi.create({
        name: anonymDraft.name.trim(),
        idCard: anonymDraft.idCard.trim(),
        address: anonymDraft.address.trim(),
      })
      return anonymsApi.assignSession({ hostName: inspectedMachine.hostName, anonymId: created.id })
    },
    onSuccess: () => {
      pushToast('Đã tạo và gán thông tin khách vãng lai.', 'success')
      setAnonymInfoOpen(false)
      setAnonymDraft({ name: '', idCard: '', address: '' })
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
      void queryClient.invalidateQueries({ queryKey: ['anonyms'] })
    },
    onError: (error: Error) => setAnonymDraftError(error.message),
  })

  const openAnonymInfo = () => {
    setAnonymDraftError(null)
    setAnonymSearch('')
    const current = assignedAnonymQuery.data
    setAnonymDraft(
      current
        ? { id: current.id, name: current.name, idCard: current.idCard, address: current.address }
        : { name: '', idCard: '', address: '' },
    )
    setAnonymInfoOpen(true)
  }

  const openInspector = (machine: WorkstationRuntime) => {
    setInspectorHost(machine.hostName)
  }

  const openMessageDialog = (hostNames: string[]) => {
    setMessageTargets(hostNames)
    setMessageText('')
    setMessageDialogOpen(true)
  }

  const openAnonymLoginDialog = (mode: 'prepaid' | 'payLater') => {
    anonymLoginIntent.clearKey()
    setLoginPriceId('')
    setLoginPriceAppRentId('')
    setLoginChargeMoney(20_000)
    setAnonymLoginOpen(mode)
  }

  const openNoteDialog = (hostNames: string[], prefill?: WorkstationRuntime) => {
    setNoteTargets(hostNames)
    setNote(prefill?.note ?? '')
    setLockLogin(prefill?.lockLogin ?? false)
    setShowLockScreen(false)
    setNoteDialogOpen(true)
  }

  const openAppsDialog = (machine: WorkstationRuntime) => {
    setAppsList(null)
    setAppsError(null)
    setAppsDialogOpen(true)
    appsQueryMutation.mutate(machine.hostName)
  }

  const openCommand = (kind: CommandKind, machines = selectedMachines) => {
    const reason = commandDisabledReason(COMMANDS[kind], machines, hasRight, isAdmin)
    if (reason) {
      pushToast(reason, 'info')
      return
    }
    if (machines.length === 1 && !selected.has(machines[0].hostName)) {
      setSelected(new Set([machines[0].hostName]))
    }
    setPendingCommand(kind)
  }

  const toggleMachine = (hostName: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(hostName)) next.delete(hostName)
      else next.add(hostName)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current)
      const allSelected = filteredMachines.every((machine) => next.has(machine.hostName))
      filteredMachines.forEach((machine) => {
        if (allSelected) next.delete(machine.hostName)
        else next.add(machine.hostName)
      })
      return next
    })
  }

  const toggleWakeupChecked = (hostName: string) => {
    setWakeupChecked((current) => {
      const next = new Set(current)
      if (next.has(hostName)) next.delete(hostName)
      else next.add(hostName)
      return next
    })
  }

  const closeMoneyDialog = () => {
    if (moneyMutation.isPending) return
    if (depositQrActive) {
      pushToast('Hãy hủy giao dịch QR đang chờ trước khi đóng cửa sổ.', 'info')
      return
    }
    moneyIntent.clearKey()
    setMoneyAction(null)
    setMoneyAmount(null)
    setDepositMethod('cash')
    setDepositQrActive(false)
    setMoneyNote('')
  }

  // may dang ONLINE nhung userId===0 = admin dang nhap bao tri (xem getWorkstationStatus)
  const playingMachines = allMachines.filter((machine) => machine.status === WORKSTATION_STATUS.ONLINE)
  const customerMachines = playingMachines.filter((machine) => machine.userId !== 0)
  const counts = {
    playing: playingMachines.length,
    available: allMachines.filter((machine) => machine.status === WORKSTATION_STATUS.AVAILABLE).length,
    disconnected: allMachines.filter(
      (machine) => machine.status === WORKSTATION_STATUS.DISCONNECT,
    ).length,
    member: customerMachines.filter((machine) => machine.userGroupType === USER_GROUP_TYPE.member).length,
    anonym: customerMachines.filter((machine) => machine.userGroupType === USER_GROUP_TYPE.anonym).length,
    combo: customerMachines.filter((machine) => machine.userGroupType === USER_GROUP_TYPE.combo).length,
    admin: playingMachines.filter((machine) => machine.userId === 0).length,
  }
  // registered = danh sach tu DB (Active=1 AND MAC<>''), doc lap RAM g_Listener --
  // dung lam mau so dung cho % lap day khu vuc (allMachines chi thay may da tung
  // connect tu luc Server khoi dong, xem HANDOFF_ws-wakeup-registered.md muc 1).
  const registeredMachines = useMemo(() => registeredQuery.data?.items ?? [], [registeredQuery.data])
  const registeredReady = registeredQuery.isSuccess
  const registeredHosts = useMemo(
    () => new Set(registeredMachines.map((m) => m.hostName)),
    [registeredMachines],
  )
  // Tu so CHI dem may ONLINE CO TRONG tap registered -> tu so <= mau so, % khong vuot 100
  // (may moi connect lan dau nhung registered chua refetch, hoac may khong co MAC
  // trong DB ma van ONLINE thi khong tinh vao tu so).
  const isCountedOnline = (machine: (typeof allMachines)[number]) =>
    machine.status === WORKSTATION_STATUS.ONLINE && (!registeredReady || registeredHosts.has(machine.hostName))

  const groupUsage = (groupsQuery.data ?? [])
    .map((group) => {
      const total = registeredReady
        ? registeredMachines.filter((m) => m.machineGroupId === group.id).length // tu DB
        : allMachines.filter((m) => m.machineGroupId === group.id).length // fallback RAM khi chua co du lieu
      const inUse = allMachines.filter(
        (machine) => machine.machineGroupId === group.id && isCountedOnline(machine),
      ).length
      return { id: group.id, name: group.name, inUse, total, percent: total > 0 ? Math.round((inUse / total) * 100) : 0 }
    })
    .sort((left, right) => right.inUse - left.inUse)
  const overallTotal = registeredReady ? registeredMachines.length : allMachines.length
  const overallInUse = allMachines.filter(isCountedOnline).length
  const overallUsagePercent = overallTotal > 0 ? Math.round((overallInUse / overallTotal) * 100) : 0

  const updateGroupScrollState = useCallback(() => {
    const el = groupScrollRef.current
    if (!el) {
      setGroupScrollState({ canLeft: false, canRight: false })
      return
    }
    const maxScroll = el.scrollWidth - el.clientWidth
    setGroupScrollState({
      canLeft: el.scrollLeft > 1,
      canRight: el.scrollLeft < maxScroll - 1,
    })
  }, [])

  useEffect(() => {
    const el = groupScrollRef.current
    if (!el) return
    updateGroupScrollState()
    const handleChange = () => updateGroupScrollState()
    el.addEventListener('scroll', handleChange, { passive: true })
    const resizeObserver = new ResizeObserver(handleChange)
    resizeObserver.observe(el)
    window.addEventListener('resize', handleChange)
    return () => {
      el.removeEventListener('scroll', handleChange)
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleChange)
    }
  }, [groupChartOrientation, groupUsage.length, updateGroupScrollState])

  const scrollGroupUsage = (direction: 1 | -1) => {
    const el = groupScrollRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 96), behavior: 'smooth' })
  }

  // Danh sach may "chua bat" -- parity CWSWakeupDlg::RefreshPCList: khong co trong
  // RAM, hoac co nhung Status la DISCONNECT/WARNING.
  const ramByHost = useMemo(() => new Map(allMachines.map((m) => [m.hostName, m])), [allMachines])
  const offCandidates = useMemo(
    () =>
      registeredMachines.filter((m) => {
        const ram = ramByHost.get(m.hostName)
        return !ram || ram.status === WORKSTATION_STATUS.DISCONNECT || ram.status === WORKSTATION_STATUS.WARNING
      }),
    [registeredMachines, ramByHost],
  )
  const wakeupSearchNormalized = wakeupSearch.trim().toLocaleLowerCase('vi-VN')
  const visibleWakeupCandidates = useMemo(
    () =>
      wakeupSearchNormalized
        ? offCandidates.filter((m) => {
            const groupName = groupsQuery.data?.find((g) => g.id === m.machineGroupId)?.name ?? ''
            return (
              m.hostName.toLocaleLowerCase('vi-VN').includes(wakeupSearchNormalized) ||
              groupName.toLocaleLowerCase('vi-VN').includes(wakeupSearchNormalized)
            )
          })
        : offCandidates,
    [offCandidates, wakeupSearchNormalized, groupsQuery.data],
  )
  const serverClockDrift =
    snapshot?.serverTimeMs && snapshotQuery.dataUpdatedAt
      ? snapshot.serverTimeMs - snapshotQuery.dataUpdatedAt
      : 0

  return (
    <section className="ws-workspace">
      <PageHeader
        eyebrow="Thu ngân"
        title="Máy trạm"
        actions={
          <div className="ws-page-actions">
            <Button
              type="button"
              variant={(paymentWaitQuery.data?.length ?? 0) > 0 ? 'primary' : 'secondary'}
              icon={<Receipt size={18} weight="bold" aria-hidden="true" />}
              onClick={() => {
                setInspectorHost(null)
                setPaymentWaitOpen(true)
              }}
            >
              Chờ tính tiền
              {(paymentWaitQuery.data?.length ?? 0) > 0 ? (
                <StatusBadge tone="warning">{paymentWaitQuery.data?.length}</StatusBadge>
              ) : null}
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon={<Power size={18} weight="bold" aria-hidden="true" />}
              onClick={() => {
                setWakeupChecked(new Set())
                setWakeupResults([])
                setWakeupSearch('')
                setWakeupOpen(true)
              }}
            >
              Mở máy trạm
              <span className="ds-badge ds-badge--neutral ws-wakeup-badge">{offCandidates.length}</span>
            </Button>
            <PollingStatus
              className="ws-page-actions__push-right"
              connected={connected}
              isError={snapshotQuery.isError}
              isFetching={snapshotQuery.isFetching}
              dataUpdatedAt={snapshotQuery.dataUpdatedAt}
              intervalMs={connected ? 30_000 : 5_000}
              errorDetail={snapshotQuery.error ? describeApiErrorCode(snapshotQuery.error) : undefined}
              onRefresh={() => snapshotQuery.refetch()}
            />
          </div>
        }
      />

      <div className="ws-summary" aria-label="Tổng quan máy trạm">
        <div className="ws-summary__card">
          <button type="button" className={`ws-summary__total ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
            <span>Máy trạm</span>
            <strong>{allMachines.length}</strong>
          </button>
          <div className="ws-summary__breakdown">
            <button type="button" className={`ws-summary__row ws-summary__playing ${filter === 'playing' ? 'is-active' : ''}`} onClick={() => setFilter('playing')}>
              <span className="ws-summary__dot ws-summary__dot--playing" aria-hidden="true" />
              <span className="ws-summary__label">Sử dụng</span>
              <strong>{counts.playing}</strong>
            </button>
            <button type="button" className={`ws-summary__row ws-summary__available ${filter === 'available' ? 'is-active' : ''}`} onClick={() => setFilter('available')}>
              <span className="ws-summary__dot ws-summary__dot--available" aria-hidden="true" />
              <span className="ws-summary__label">Sẵn sàng</span>
              <strong>{counts.available}</strong>
            </button>
            <button type="button" className={`ws-summary__row ws-summary__disconnected ${filter === 'disconnected' ? 'is-active' : ''}`} onClick={() => setFilter('disconnected')}>
              <span className="ws-summary__dot ws-summary__dot--disconnected" aria-hidden="true" />
              <span className="ws-summary__label">Mất kết nối</span>
              <strong>{counts.disconnected}</strong>
            </button>
          </div>
        </div>

        <div className="ws-summary__card">
          <button type="button" className={`ws-summary__total ${filter === 'playing' ? 'is-active' : ''}`} onClick={() => setFilter('playing')}>
            <span>Sử dụng</span>
            <strong>{counts.playing}</strong>
          </button>
          <div className="ws-summary__breakdown">
            <div className="ws-summary__row">
              <span className="ws-summary__dot ws-summary__dot--member" aria-hidden="true" />
              <span className="ws-summary__label">Hội viên</span>
              <strong>{counts.member}</strong>
            </div>
            <div className="ws-summary__row">
              <span className="ws-summary__dot ws-summary__dot--anonym" aria-hidden="true" />
              <span className="ws-summary__label">Vãng lai</span>
              <strong>{counts.anonym}</strong>
            </div>
            <div className="ws-summary__row">
              <span className="ws-summary__dot ws-summary__dot--combo" aria-hidden="true" />
              <span className="ws-summary__label">Combo</span>
              <strong>{counts.combo}</strong>
            </div>
            {counts.admin > 0 ? (
              <div className="ws-summary__row">
                <span className="ws-summary__dot ws-summary__dot--admin" aria-hidden="true" />
                <span className="ws-summary__label">Admin</span>
                <strong>{counts.admin}</strong>
              </div>
            ) : null}
          </div>
        </div>

        {groupUsage.length > 0 ? (
          <div className="ws-summary__card">
            <div className="ws-summary__total ws-summary__total--static">
              <span>Khu vực</span>
              <strong>{overallUsagePercent}%</strong>
              <div className="ws-group-usage__orientation" role="group" aria-label="Kiểu biểu đồ khu vực">
                <button
                  type="button"
                  className={`ws-group-usage__orientationBtn ${groupChartOrientation === 'row' ? 'is-active' : ''}`}
                  aria-pressed={groupChartOrientation === 'row'}
                  title="Biểu đồ thanh ngang"
                  onClick={() => setGroupChartOrientation('row')}
                >
                  <ChartBarHorizontal size={18} weight="bold" />
                </button>
                <button
                  type="button"
                  className={`ws-group-usage__orientationBtn ${groupChartOrientation === 'donut' ? 'is-active' : ''}`}
                  aria-pressed={groupChartOrientation === 'donut'}
                  title="Biểu đồ donut"
                  onClick={() => setGroupChartOrientation('donut')}
                >
                  <ChartDonut size={18} weight="bold" />
                </button>
              </div>
            </div>
            <div className="ws-group-usage__scrollWrap">
              {groupScrollState.canLeft ? (
                <button
                  type="button"
                  className="ws-group-usage__scrollBtn ws-group-usage__scrollBtn--left"
                  aria-label="Cuộn sang trái"
                  onClick={() => scrollGroupUsage(-1)}
                >
                  <CaretLeft size={16} weight="bold" />
                </button>
              ) : null}
              {groupChartOrientation === 'donut' ? (
                <div className="ws-group-usage__breakdown" ref={groupScrollRef}>
                  {groupUsage.map((group) => {
                    const dashArray = `${(group.percent / 100) * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`
                    return (
                      <button
                        key={group.id}
                        type="button"
                        className={`ws-group-usage__donutItem ${groupId === group.id ? 'is-active' : ''}`}
                        aria-pressed={groupId === group.id}
                        aria-label={`${group.name}: ${group.inUse}/${group.total} máy đang dùng (${group.percent}%)`}
                        title={`${group.name}: ${group.inUse}/${group.total} (${group.percent}%)`}
                        onClick={() => setGroupId((current) => (current === group.id ? 0 : group.id))}
                      >
                        <span className="ws-group-usage__donutCount">
                          {group.inUse}/{group.total}
                        </span>
                        <div className="ws-group-usage__donut">
                          <svg viewBox="0 0 36 36">
                            <circle className="ws-group-usage__donutTrack" cx="18" cy="18" r={DONUT_RADIUS} />
                            <circle
                              className="ws-group-usage__donutFill"
                              cx="18"
                              cy="18"
                              r={DONUT_RADIUS}
                              strokeDasharray={dashArray}
                            />
                          </svg>
                          <span className="ws-group-usage__donutLabel">
                            {group.percent >= 100 ? (
                              <Check size={11} weight="bold" aria-hidden="true" />
                            ) : (
                              `${group.percent}%`
                            )}
                          </span>
                        </div>
                        <span className="ws-group-usage__donutName" title={group.name}>
                          {group.name}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="ws-group-usage__breakdown ws-group-usage__breakdown--row" ref={groupScrollRef}>
                  {groupUsage.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`ws-group-usage__row ${groupId === group.id ? 'is-active' : ''}`}
                      aria-pressed={groupId === group.id}
                      title={`${group.name}: ${group.inUse}/${group.total} (${group.percent}%)`}
                      onClick={() => setGroupId((current) => (current === group.id ? 0 : group.id))}
                    >
                      <span
                        className="ws-summary__dot ws-group-usage__dot"
                        style={{ opacity: 0.16 + (group.percent / 100) * 0.84 }}
                        aria-hidden="true"
                      />
                      <span className="ws-summary__label ws-group-usage__name" title={group.name}>
                        {group.name}
                      </span>
                      <strong className="ws-group-usage__count">{group.inUse}/{group.total}</strong>
                      <div
                        className="ws-group-usage__track"
                        role="img"
                        aria-label={`${group.name}: ${group.inUse}/${group.total} máy đang dùng (${group.percent}%)`}
                      >
                        <div className="ws-group-usage__fill" style={{ width: `${group.percent}%` }} />
                        <span
                          className={`ws-group-usage__trackLabel ${group.percent >= 50 ? 'ws-group-usage__trackLabel--full' : ''}`}
                        >
                          {group.percent >= 100 ? 'Đầy' : `${group.percent}%`}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {groupScrollState.canRight ? (
                <button
                  type="button"
                  className="ws-group-usage__scrollBtn ws-group-usage__scrollBtn--right"
                  aria-label="Cuộn sang phải"
                  onClick={() => scrollGroupUsage(1)}
                >
                  <CaretRight size={16} weight="bold" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {Math.abs(serverClockDrift) > 120_000 ? (
        <InlineAlert tone="warning">
          Đồng hồ máy thu ngân lệch máy chủ khoảng {Math.round(serverClockDrift / 60_000)} phút.
          Bộ đếm phiên vẫn dùng mốc snapshot cục bộ để tránh nhảy giờ.
        </InlineAlert>
      ) : null}

      <div className="ws-toolbar">
        <div className="ds-field ws-search">
          <span className="ds-field__label ds-visually-hidden">Tìm nhanh</span>
          <div className="ds-input-group ds-input-group--search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                placeholder="Tên máy, IP, khách hàng hoặc ghi chú"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="ws-toolbar__end">
          <div className="ws-toolbar__count" aria-live="polite">
            <strong>{filteredMachines.length}</strong>
            <span>/ {allMachines.length} máy</span>
          </div>
          <details className="ws-columns">
            <summary aria-label="Chọn cột hiển thị">Cột hiển thị</summary>
            <div className="ws-columns__menu">
              <strong>Hiển thị cột</strong>
              {COLUMNS.map((column) => (
                <label key={column.id} className={column.required ? 'is-required' : undefined}>
                  <input
                    type="checkbox"
                    checked={column.required || optionalColumns.has(column.id)}
                    disabled={column.required}
                    onChange={() => toggleColumn(column.id)}
                  />
                  <span>{column.label}</span>
                  {column.required ? <small>Bắt buộc</small> : null}
                </label>
              ))}
            </div>
          </details>
        </div>
      </div>

      {selectedMachines.length > 0 ? (
        <div className="ws-selection-bar">
          <strong>{selectedMachines.length} máy đã chọn</strong>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={Boolean(commandDisabledReason(COMMANDS.logout, selectedMachines, hasRight, isAdmin))}
              title={commandDisabledReason(COMMANDS.logout, selectedMachines, hasRight, isAdmin) || undefined}
              onClick={() => openCommand('logout')}
            >
              Đăng xuất
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!hasRight(RIGHTS.CHANGE_GROUP)}
              title={!hasRight(RIGHTS.CHANGE_GROUP) ? `Thiếu quyền ${RIGHTS.CHANGE_GROUP}` : undefined}
              onClick={() => {
                setTargetGroupId(groupsQuery.data?.[0]?.id ?? 0)
                setGroupDialogOpen(true)
              }}
            >
              Đổi nhóm
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openNoteDialog(selectedMachines.map((machine) => machine.hostName))}
            >
              Ghi chú / giữ máy
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => openMessageDialog(selectedMachines.map((machine) => machine.hostName))}
            >
              Nhắn tin
            </Button>
            <span className="ws-selection-bar__divider" />
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(commandDisabledReason(COMMANDS.wakeup, selectedMachines, hasRight, isAdmin))}
              title={commandDisabledReason(COMMANDS.wakeup, selectedMachines, hasRight, isAdmin) || undefined}
              onClick={() => openCommand('wakeup')}
            >
              Mở máy trạm
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(commandDisabledReason(COMMANDS.restart, selectedMachines, hasRight, isAdmin))}
              onClick={() => openCommand('restart')}
            >
              Khởi động lại
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={Boolean(commandDisabledReason(COMMANDS.closeApp, selectedMachines, hasRight, isAdmin))}
              onClick={() => openCommand('closeApp')}
            >
              Đóng ứng dụng
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={Boolean(commandDisabledReason(COMMANDS.shutdown, selectedMachines, hasRight, isAdmin))}
              onClick={() => openCommand('shutdown')}
            >
              Tắt máy
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
              Bỏ chọn
            </Button>
          </div>
        </div>
      ) : null}

      <div className="ws-content">
        {snapshotQuery.isLoading ? (
          <StateView title="Đang tải danh sách máy" description="Đang lấy snapshot vận hành từ máy chủ." />
        ) : snapshotQuery.isError ? (
          <StateView
            title="Không tải được máy trạm"
            description={(snapshotQuery.error as Error).message}
            action={<Button onClick={() => snapshotQuery.refetch()}>Thử lại</Button>}
          />
        ) : (
          <WorkstationVirtualList
            machines={filteredMachines}
            elapsedSeconds={elapsedSeconds}
            selected={selected}
            onToggle={toggleMachine}
            onSelectAll={toggleAllVisible}
            onOpen={openInspector}
            groups={groupsQuery.data ?? []}
            groupId={groupId}
            onGroupChange={setGroupId}
            filter={filter}
            onFilterChange={setFilter}
            visibleColumns={visibleColumns}
            emptyState={
              hasActiveFilter ? (
                <StateView
                  title="Không có máy phù hợp"
                  description="Hãy đổi bộ lọc hoặc từ khóa tìm kiếm."
                  action={<Button onClick={() => { setSearch(''); setGroupId(0); setFilter('all') }}>Xóa bộ lọc</Button>}
                />
              ) : (
                <StateView title="Chưa có máy trạm nào" />
              )
            }
          />
        )}
      </div>

      <Drawer
        open={Boolean(inspectedMachine)}
        title={inspectedMachine?.hostName ?? 'Chi tiết máy'}
        description={inspectedMachine ? `${inspectedMachine.ip || 'Không có IP'} · ${inspectedMachine.machineGroupName || `Nhóm ${inspectedMachine.machineGroupId}`}` : undefined}
        onClose={() => setInspectorHost(null)}
      >
        {inspectedMachine && status ? (
          <div className="ws-inspector" key={inspectedMachine.hostName}>
            <InspectorGroup
              icon={<Clock size={22} weight="duotone" />}
              title="Phiên hiện tại"
              defaultExpanded
              badges={
                <>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  {flags.map((flag) => <StatusBadge key={flag.label} tone={flag.tone}>{flag.label}</StatusBadge>)}
                </>
              }
              summary={
                inspectedMachine.session
                  ? `${inspectedMachine.userName || '—'} · ${sessionLabel(inspectedMachine.session)} · còn ${formatDuration(clock.remaining, 'minutes')}`
                  : inspectedMachine.status === WORKSTATION_STATUS.AVAILABLE
                    ? 'Máy trống, sẵn sàng đăng nhập'
                    : 'Không có phiên'
              }
              action={
                inspectedMachine.status === WORKSTATION_STATUS.AVAILABLE ? (
                  <Button
                    icon={<SignIn {...ICON} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused || !hasRight(RIGHTS.PREPAID_LOGIN)}
                    title={!hasRight(RIGHTS.PREPAID_LOGIN) ? `Thiếu quyền ${RIGHTS.PREPAID_LOGIN}` : undefined}
                    onClick={() => openAnonymLoginDialog('prepaid')}
                  >
                    Đăng nhập
                  </Button>
                ) : inspectedMachine.session && !isAdminSession && inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ? (
                  <Button
                    icon={<Receipt {...ICON} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused}
                    onClick={() => setMoneyAction(inspectedMachine.session?.prepaid ? 'payoutPrepaid' : 'payout')}
                  >
                    Tính tiền
                  </Button>
                ) : inspectedMachine.status !== WORKSTATION_STATUS.AVAILABLE && inspectedMachine.session ? (
                  <Button
                    icon={<ChatCircleText {...ICON} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused}
                    onClick={() => openMessageDialog([inspectedMachine.hostName])}
                  >
                    Nhắn tin
                  </Button>
                ) : null
              }
            >
              <dl className="ws-detail-list ws-detail-list--inline">
                <div><dt>Tài khoản</dt><dd>{inspectedMachine.userName || '—'}</dd></div>
                <div><dt>Loại</dt><dd>{sessionLabel(inspectedMachine.session)}</dd></div>
                <div><dt>Bắt đầu</dt><dd>{formatStartedAt(inspectedMachine.session?.startedAt, 'minutes')}</dd></div>
                <div><dt>Đã dùng</dt><dd>{formatDuration(clock.used, 'minutes')}</dd></div>
                <div><dt>Còn lại</dt><dd>{formatDuration(clock.remaining, 'minutes')}</dd></div>
                <div><dt>Phí tạm tính</dt><dd>{formatMoney(inspectedMachine.session?.totalAmount)}</dd></div>
                <div><dt>Số dư</dt><dd>{formatMoney(inspectedMachine.session?.remainingMoney)}</dd></div>
                <div><dt>Combo</dt><dd>{inspectedMachine.session?.comboName || '—'}</dd></div>
                <div className="ws-note-row">
                  <dt>Ghi chú</dt>
                  <dd>
                    <div className="ws-note-cell">
                      <span className={noteExpanded ? 'ws-note-text' : 'ws-note-text ws-note-text--collapsed'}>
                        {inspectedMachine.note || '—'}
                      </span>
                      <span className="ws-note-controls">
                        {inspectedMachine.note ? (
                          <IconButton
                            label={noteExpanded ? 'Thu gọn ghi chú' : 'Xem đầy đủ ghi chú'}
                            icon={noteExpanded ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
                            onClick={() => setNoteExpanded((value) => !value)}
                          />
                        ) : null}
                        <IconButton
                          label="Sửa ghi chú"
                          icon={<PencilSimple size={14} weight="bold" />}
                          variant="secondary"
                          disabled={isPaused}
                          onClick={() => openNoteDialog([inspectedMachine.hostName], inspectedMachine)}
                        />
                      </span>
                    </div>
                  </dd>
                </div>
              </dl>
              {inspectedMachine.status !== WORKSTATION_STATUS.AVAILABLE ? (
                <div className="ws-action-grid">
                  <Button
                    icon={<ChatCircleText {...ICON} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused}
                    onClick={() => openMessageDialog([inspectedMachine.hostName])}
                  >
                    Nhắn tin
                  </Button>
                </div>
              ) : null}
              {inspectedMachine.status === WORKSTATION_STATUS.AVAILABLE ? (
                <div className="ws-action-grid ws-action-grid--nowrap">
                  <Button
                    icon={<SignIn {...ICON} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused || !hasRight(RIGHTS.PREPAID_LOGIN)}
                    title={!hasRight(RIGHTS.PREPAID_LOGIN) ? `Thiếu quyền ${RIGHTS.PREPAID_LOGIN}` : undefined}
                    onClick={() => openAnonymLoginDialog('prepaid')}
                  >
                    Đăng nhập (trả tiền trước)
                  </Button>
                  <Button
                    icon={<SignIn {...ICON} />}
                    type="button"
                    variant="secondary"
                    disabled={isPaused || !hasRight(RIGHTS.POSTPAID_LOGIN)}
                    title={!hasRight(RIGHTS.POSTPAID_LOGIN) ? `Thiếu quyền ${RIGHTS.POSTPAID_LOGIN}` : undefined}
                    onClick={() => openAnonymLoginDialog('payLater')}
                  >
                    Đăng nhập (trả tiền sau)
                  </Button>
                </div>
              ) : null}
              {inspectedMachine.session && !isAdminSession ? (
                <div className="ws-action-grid">
                  {inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ? (
                    <Button icon={<Receipt {...ICON} />} type="button" variant="primary" disabled={isPaused} onClick={() => setMoneyAction(inspectedMachine.session?.prepaid ? 'payoutPrepaid' : 'payout')}>
                      Tính tiền
                    </Button>
                  ) : null}
                  {hasDebt(inspectedMachine) && inspectedMachine.userId > 0 ? (
                    <Button icon={<Money {...ICON} />} type="button" variant="secondary" disabled={isPaused} onClick={() => setMoneyAction('payDebit')}>
                      Thanh toán phí chuyển
                    </Button>
                  ) : null}
                  {!inspectedMachine.session.prepaid && inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ? (
                    <Button
                      icon={<HourglassMedium {...ICON} />}
                      type="button"
                      variant="secondary"
                      disabled={isPaused || !hasRight(RIGHTS.SUSPEND_MACHINE)}
                      title={!hasRight(RIGHTS.SUSPEND_MACHINE) ? `Thiếu quyền ${RIGHTS.SUSPEND_MACHINE}` : undefined}
                      onClick={() => setMoneyAction('suspend')}
                    >
                      Chờ tính tiền
                    </Button>
                  ) : null}
                  {inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ||
                  inspectedMachine.userGroupType === USER_GROUP_TYPE.member ? (
                    // Parity WorkstationList.cpp:1939-1950/1965-1969 -- IDR_CHANGE_WS/IDR_SWAP_WS
                    // chi bat cho ANONYM/MEMBER, COMBOCARD (the combo) khong duoc chuyen may.
                    <Button
                      icon={<ArrowsLeftRight {...ICON} />}
                      type="button"
                      variant="secondary"
                      disabled={isPaused}
                      onClick={() => {
                        setChangePcMode('change')
                        setChangePcTarget('')
                        setChangePcOpen(true)
                      }}
                    >
                      Chuyển máy
                    </Button>
                  ) : null}
                  {!inspectedMachine.session.prepaid &&
                  inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym &&
                  inspectedMachine.status === WORKSTATION_STATUS.ONLINE ? (
                    <Button
                      icon={<Wallet {...ICON} />}
                      type="button"
                      variant="secondary"
                      disabled={isPaused}
                      onClick={() => {
                        setPrepaidAmount(20_000)
                        setPrepaidOpen(true)
                      }}
                    >
                      Chuyển sang trả trước
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="ws-action-grid">
                <Button
                  icon={<Lock {...ICON} />}
                  type="button"
                  variant="danger-outline"
                  disabled={isPaused || Boolean(commandDisabledReason(COMMANDS.logout, [inspectedMachine], hasRight, isAdmin))}
                  title={commandDisabledReason(COMMANDS.logout, [inspectedMachine], hasRight, isAdmin) || undefined}
                  onClick={() => openCommand('logout', [inspectedMachine])}
                >
                  Khóa máy
                </Button>
                <Button
                  icon={<UserGear {...ICON} />}
                  type="button"
                  variant="warning-outline"
                  disabled={isPaused || Boolean(commandDisabledReason(COMMANDS.adminLogin, [inspectedMachine], hasRight, isAdmin))}
                  title={commandDisabledReason(COMMANDS.adminLogin, [inspectedMachine], hasRight, isAdmin) || undefined}
                  onClick={() => openCommand('adminLogin', [inspectedMachine])}
                >
                  Đăng nhập ADMIN
                </Button>
              </div>
            </InspectorGroup>

            {inspectedMachine.userId > 0 ? (
              <InspectorGroup
                icon={<UserCircle size={22} weight="duotone" />}
                title="Tài khoản"
                badges={
                  userKind ? (
                    <span
                      className={`ds-badge ws-user-badge ws-user-badge--${userKind}`}
                      title={USER_KIND_LABEL[userKind]}
                      aria-label={`${USER_KIND_LABEL[userKind]}: ${inspectedMachine.userName || '—'}`}
                    >
                      {inspectedMachine.userName || '—'}
                    </span>
                  ) : (
                    <span className="ds-badge ds-badge--neutral">{inspectedMachine.userName || '—'}</span>
                  )
                }
                summary={
                  inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym
                    ? assignedAnonymQuery.data?.name || 'Chưa gán thông tin khách vãng lai'
                    : exactUser
                      ? `Số dư chính ${formatMoney(exactUser.moneyMain)}`
                      : undefined
                }
                action={
                  inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ? (
                    !assignedAnonymId ? (
                      <Button icon={<UserPlus {...ICON} />} type="button" variant="secondary" disabled={isPaused} onClick={openAnonymInfo}>
                        Gán thông tin
                      </Button>
                    ) : null
                  ) : exactUser ? (
                    <Button
                      icon={<CurrencyCircleDollar {...ICON} />}
                      type="button"
                      variant="primary"
                      disabled={isPaused || !hasRight(RIGHTS.MODIFY_MONEY)}
                      title={!hasRight(RIGHTS.MODIFY_MONEY) ? `Thiếu quyền ${RIGHTS.MODIFY_MONEY}` : undefined}
                      onClick={() => {
                        setMoneyAmount(null)
                        setDepositMethod('cash')
                        setDepositQrActive(false)
                        setMoneyAction('deposit')
                      }}
                    >
                      Nạp tiền
                    </Button>
                  ) : null
                }
              >
                {inspectedMachine.userGroupType === USER_GROUP_TYPE.anonym ? (
                  <>
                    {assignedAnonymQuery.isLoading ? (
                      <p className="ws-muted">Đang tải thông tin khách vãng lai…</p>
                    ) : assignedAnonymQuery.data ? (
                      <dl className="ws-detail-list">
                        <div><dt>Họ tên</dt><dd>{assignedAnonymQuery.data.name}</dd></div>
                        <div><dt>CCCD</dt><dd>{maskIdCard(assignedAnonymQuery.data.idCard)}</dd></div>
                        <div><dt>Địa chỉ</dt><dd>{assignedAnonymQuery.data.address || '—'}</dd></div>
                      </dl>
                    ) : null}
                    <div className="ws-action-grid">
                      <Button icon={<UserPlus {...ICON} />} type="button" variant="secondary" disabled={isPaused || Boolean(assignedAnonymId)} onClick={openAnonymInfo}>
                        {assignedAnonymId ? 'Đã gán thông tin khách vãng lai' : 'Gán thông tin khách vãng lai'}
                      </Button>
                      <Button
                        icon={<Gift {...ICON} />}
                        type="button"
                        variant="secondary"
                        disabled={isPaused || !hasRight(RIGHTS.MODIFY_MONEY)}
                        title={!hasRight(RIGHTS.MODIFY_MONEY) ? `Thiếu quyền ${RIGHTS.MODIFY_MONEY}` : undefined}
                        onClick={() => { setMoneyAmount(10_000); setMoneyAction('giveFree') }}
                      >
                        Tặng tiền
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {userQuery.isLoading ? <p className="ws-muted">Đang tải số dư…</p> : null}
                    {exactUser ? (
                      <>
                        <dl className="ws-detail-list">
                          <div><dt>Số dư chính</dt><dd>{formatMoney(exactUser.moneyMain)}</dd></div>
                          <div><dt>Số dư phụ</dt><dd>{formatMoney(exactUser.moneySub)}</dd></div>
                        </dl>
                        <div className="ws-action-grid">
                          <Button
                            icon={<CurrencyCircleDollar {...ICON} />}
                            type="button"
                            variant="primary"
                            disabled={isPaused || !hasRight(RIGHTS.MODIFY_MONEY)}
                            title={!hasRight(RIGHTS.MODIFY_MONEY) ? `Thiếu quyền ${RIGHTS.MODIFY_MONEY}` : undefined}
                            onClick={() => {
                              setMoneyAmount(null)
                              setDepositMethod('cash')
                              setDepositQrActive(false)
                              setMoneyAction('deposit')
                            }}
                          >
                            Nạp tiền
                          </Button>
                          <Button
                            icon={<Gift {...ICON} />}
                            type="button"
                            variant="secondary"
                            disabled={isPaused || !hasRight(RIGHTS.MODIFY_MONEY)}
                            title={!hasRight(RIGHTS.MODIFY_MONEY) ? `Thiếu quyền ${RIGHTS.MODIFY_MONEY}` : undefined}
                            onClick={() => { setMoneyAmount(10_000); setMoneyAction('giveFree') }}
                          >
                            Tặng tiền
                          </Button>
                          <Button
                            icon={<HandCoins {...ICON} />}
                            type="button"
                            variant="secondary"
                            disabled={isPaused || !hasRight(RIGHTS.CREDIT_MONEY)}
                            title={!hasRight(RIGHTS.CREDIT_MONEY) ? `Thiếu quyền ${RIGHTS.CREDIT_MONEY}` : undefined}
                            onClick={() => { setMoneyAmount(10_000); setMoneyAction('credit') }}
                          >
                            Cho mượn tiền
                          </Button>
                        </div>
                      </>
                    ) : userQuery.isError ? (
                      <InlineAlert tone="warning">Không tải được hồ sơ hội viên; có thể mở trang Khách hàng để xử lý.</InlineAlert>
                    ) : null}
                  </>
                )}
              </InspectorGroup>
            ) : null}

            {inspectedMachine.session && !isAdminSession ? (
              <InspectorGroup
                icon={<ForkKnife size={22} weight="duotone" />}
                title="Đơn hàng"
                badges={
                  // Đơn đang đợi thu ngân (món chờ + combo chờ) — thấy được cả khi nhóm đang thu gọn.
                  machineOrdersWaitingTotal(machineOrders.summary) > 0 ? (
                    <StatusBadge tone="warning">{`${machineOrdersWaitingTotal(machineOrders.summary)} chờ duyệt`}</StatusBadge>
                  ) : null
                }
                summary={
                  machineOrdersLoading
                    ? 'Đang tải đơn hàng…'
                    : machineOrdersError
                      ? 'Không tải được danh sách đơn'
                      : <MachineOrdersCounts summary={machineOrders.summary} />
                }
                action={
                  // Tạo đơn = tạo đơn NGAY cho tài khoản đang ngồi máy này (hộp thoại "Gọi món hộ", máy
                  // chọn sẵn). Duyệt dịch vụ / duyệt combo nằm ở phần bung (điều hướng sang trang duyệt).
                  <Button
                    icon={<CallBellIcon size={ICON.size} />}
                    type="button"
                    variant="primary"
                    disabled={isPaused}
                    onClick={() => setStaffOrderOpen(true)}
                  >
                    Tạo đơn
                  </Button>
                }
              >
                <MachineOrderList
                  view={machineOrders}
                  error={machineOrdersError}
                  onReviewServices={() => {
                    setOrderHost(inspectedMachine.hostName)
                    setOrderCustomerName(inspectedMachine.userName ?? '')
                    navigate('/orders')
                  }}
                  onReviewCombos={() => navigate('/combo_sale?pending=1')}
                />
              </InspectorGroup>
            ) : null}

            <InspectorGroup
              icon={<Desktop size={22} weight="duotone" />}
              title="Điều khiển hệ thống"
              summary="Mở máy trạm, khởi động lại, tắt máy, ứng dụng đang chạy"
              action={
                (() => {
                  // Offline -> hanh dong hop ly nhat la Bat may; con lai la Khoi dong lai.
                  const kind: CommandKind = commandDisabledReason(COMMANDS.wakeup, [inspectedMachine], hasRight, isAdmin)
                    ? 'restart'
                    : 'wakeup'
                  const reason = commandDisabledReason(COMMANDS[kind], [inspectedMachine], hasRight, isAdmin)
                  return (
                    <Button
                      type="button"
                      variant={kind === 'restart' ? 'warning-outline' : 'secondary'}
                      disabled={kind === 'wakeup' ? Boolean(reason) : isPaused || Boolean(reason)}
                      title={reason || undefined}
                      icon={COMMAND_ICONS[kind]}
                      onClick={() => openCommand(kind, [inspectedMachine])}
                    >
                      {COMMANDS[kind].label}
                    </Button>
                  )
                })()
              }
            >
              {(() => {
                const commandButton = (kind: CommandKind) => {
                  const definition = COMMANDS[kind]
                  const reason = commandDisabledReason(definition, [inspectedMachine], hasRight, isAdmin)
                  return (
                    <Button
                      key={kind}
                      type="button"
                      variant={kind === 'shutdown' ? 'danger-outline' : kind === 'restart' ? 'warning-outline' : 'secondary'}
                      disabled={kind === 'wakeup' ? Boolean(reason) : isPaused || Boolean(reason)}
                      title={reason || undefined}
                      icon={COMMAND_ICONS[kind]}
                      onClick={() => openCommand(kind, [inspectedMachine])}
                    >
                      {definition.label}
                    </Button>
                  )
                }
                return (
                  <>
                    <div className="ws-action-grid ws-action-grid--nowrap">
                      {(['wakeup', 'restart', 'shutdown'] as CommandKind[]).map(commandButton)}
                    </div>
                    {/* Dong rieng: "Dong ung dung" va "Ung dung dang chay" cung lam viec tren app cua may. */}
                    <div className="ws-action-grid">
                      {commandButton('closeApp')}
                      <Button
                        icon={<AppWindow {...ICON} />}
                        type="button"
                        variant="secondary"
                        disabled={isPaused}
                        onClick={() => openAppsDialog(inspectedMachine)}
                      >
                        Ứng dụng đang chạy
                      </Button>
                    </div>
                  </>
                )
              })()}
              <InlineAlert tone="info">
                Âm lượng, xem màn hình và điều khiển từ xa đang chờ backend (2.22).
              </InlineAlert>
            </InspectorGroup>

            <InspectorGroup
              icon={<Info size={22} weight="duotone" />}
              title="Thông tin kỹ thuật"
              summary={
                <span className="ws-tech-summary">
                  <span className="ws-tech-summary__text">Phiên bản {inspectedMachine.version || '—'}</span>
                  <WinLicenseBadge machine={inspectedMachine} />
                </span>
              }
              action={
                !inspectedMachine.verNew ? (
                  <span className="ws-winlic-line">
                    <StatusBadge tone="success" title="Đã mới nhất">
                      <CheckCircle size={14} weight="bold" />
                    </StatusBadge>
                  </span>
                ) : commandDisabledReason(COMMANDS.update, [inspectedMachine], hasRight, isAdmin) ? null : (
                  <Button
                    icon={<ArrowCircleUp size={13} weight="bold" aria-hidden />}
                    type="button"
                    variant="secondary"
                    className="ws-btn-gradient"
                    disabled={isPaused}
                    onClick={() => openCommand('update', [inspectedMachine])}
                  >
                    {COMMANDS.update.label}
                  </Button>
                )
              }
            >
              <dl className="ws-detail-list">
                <div>
                  <dt>Phiên bản</dt>
                  <dd>
                    <div className="ws-detail-value-row">
                      <span>{inspectedMachine.version || '—'}</span>
                      {!inspectedMachine.verNew ? (
                        <StatusBadge tone="success">
                          <CheckCircle size={14} weight="bold" />
                          Đã mới nhất
                        </StatusBadge>
                      ) : (
                        <Button
                          icon={<ArrowCircleUp size={13} weight="bold" aria-hidden />}
                          type="button"
                          variant="secondary"
                          className="ws-btn-gradient"
                          disabled={isPaused || Boolean(commandDisabledReason(COMMANDS.update, [inspectedMachine], hasRight, isAdmin))}
                          title={commandDisabledReason(COMMANDS.update, [inspectedMachine], hasRight, isAdmin) || undefined}
                          onClick={() => openCommand('update', [inspectedMachine])}
                        >
                          {COMMANDS.update.label}
                        </Button>
                      )}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt>Bản quyền Windows</dt>
                  <dd><WinLicenseCell machine={inspectedMachine} /></dd>
                </div>
              </dl>
            </InspectorGroup>

            <InspectorGroup
              icon={<Circuitry size={22} weight="duotone" />}
              title="Phần cứng"
              summary={
                hw ? (
                  <span className="ws-hw-summary">
                    <span className="ws-hw-summary__item">
                      <Cpu size={14} weight="bold" className="ws-hw-summary__icon" />
                      <Thermometer size={14} weight="bold" style={{ color: TONE_TEXT_COLOR[tempTone(hw.cpu.tempC)] }} />
                      <span style={{ color: TONE_TEXT_COLOR[tempTone(hw.cpu.tempC)] }}>{num(hw.cpu.tempC, '°C') ?? '—'}</span>
                    </span>
                    <span className="ws-hw-summary__item">
                      <GraphicsCard size={14} weight="bold" className="ws-hw-summary__icon" />
                      <Thermometer size={14} weight="bold" style={{ color: TONE_TEXT_COLOR[tempTone(hw.gpu.tempC)] }} />
                      <span style={{ color: TONE_TEXT_COLOR[tempTone(hw.gpu.tempC)] }}>{num(hw.gpu.tempC, '°C') ?? '—'}</span>
                    </span>
                    {hwErrorsTitle ? (
                      <span
                        className="ws-hw-summary__item"
                        title={hwErrorsTitle}
                        aria-label={`Thiếu dữ liệu phần cứng: ${hwErrorsTitle}`}
                        style={{ color: TONE_TEXT_COLOR.warning }}
                      >
                        <Warning size={14} weight="fill" />
                      </span>
                    ) : null}
                    {hw.updatedAtSec ? (
                      <span className="ws-hw-summary__time">
                        {new Date(hw.updatedAtSec * 1000).toLocaleTimeString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        })}
                      </span>
                    ) : null}
                  </span>
                ) : undefined
              }
            >
              <HardwareBlock hostName={inspectedMachine.hostName} />
            </InspectorGroup>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={paymentWaitOpen}
        title="Chờ tính tiền"
        description="Phiên vãng lai đã rời máy nhưng chưa chốt phí."
        onClose={() => setPaymentWaitOpen(false)}
      >
        <div className="ws-wait-panel">
          <InlineAlert tone="info">
            Khi thu tiền, máy chủ tính lại phí thời gian và dịch vụ. Số bên dưới chỉ là
            snapshot để đối chiếu.
          </InlineAlert>
          {paymentWaitQuery.isLoading ? (
            <StateView title="Đang tải phiên chờ" />
          ) : paymentWaitQuery.isError ? (
            <StateView
              title="Không tải được phiên chờ"
              description={(paymentWaitQuery.error as Error).message}
              action={<Button onClick={() => paymentWaitQuery.refetch()}>Thử lại</Button>}
            />
          ) : (paymentWaitQuery.data?.length ?? 0) === 0 ? (
            <StateView
              title="Không có phiên chờ"
              description="Các phiên được đưa vào chờ tính tiền sẽ xuất hiện tại đây."
            />
          ) : (
            <div className="ws-wait-list">
              {(paymentWaitQuery.data ?? []).map((log) => (
                <article key={log.id} className="ws-wait-card">
                  <header>
                    <div>
                      <strong>{log.machineName}</strong>
                      <span>Phiên #{log.id}</span>
                    </div>
                    <StatusBadge tone="warning">Chờ thu</StatusBadge>
                  </header>
                  <dl className="ws-detail-list">
                    <div><dt>Bắt đầu</dt><dd>{formatStartedAt(log.beginTime, 'minutes')}</dd></div>
                    <div><dt>Kết thúc</dt><dd>{formatStartedAt(log.endTime, 'minutes')}</dd></div>
                    <div><dt>Thời gian dùng</dt><dd>{formatDuration(log.totalTimeUsed, 'minutes')}</dd></div>
                    <div><dt>Phí thời gian</dt><dd>{formatMoney(log.totalTimeFee)}</dd></div>
                    <div><dt>Ghi chú</dt><dd>{log.note || '—'}</dd></div>
                  </dl>
                  <div className="ws-action-grid">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={paymentWaitPayoutMutation.isPending}
                      onClick={() => setPayoutWaitLog(log)}
                    >
                      Tính tiền
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={availableMachines.length === 0}
                      title={availableMachines.length === 0 ? 'Không có máy Sẵn sàng' : undefined}
                      onClick={() => {
                        setContinueTarget(availableMachines[0]?.hostName ?? '')
                        setContinueWaitLog(log)
                      }}
                    >
                      Dùng tiếp
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Drawer>

      <Drawer
        open={wakeupOpen}
        title="Mở máy trạm"
        description="Chức năng này chỉ hoạt động khi máy trạm có mainboard hổ trợ và hệ điều hành đã bật chức năng này."
        onClose={() => setWakeupOpen(false)}
        className="ws-wakeup-drawer"
        footer={
          offCandidates.length > 0 ? (
            <div className="ws-wakeup-footer">
              <label className="ws-wait-card__select ws-wakeup-selectall">
                <input
                  type="checkbox"
                  checked={visibleWakeupCandidates.length > 0 && visibleWakeupCandidates.every((m) => wakeupChecked.has(m.hostName))}
                  onChange={() => {
                    const allVisibleChecked =
                      visibleWakeupCandidates.length > 0 && visibleWakeupCandidates.every((m) => wakeupChecked.has(m.hostName))
                    setWakeupChecked((current) => {
                      const next = new Set(current)
                      visibleWakeupCandidates.forEach((m) => {
                        if (allVisibleChecked) next.delete(m.hostName)
                        else next.add(m.hostName)
                      })
                      return next
                    })
                  }}
                />
                <span>Chọn tất cả ({visibleWakeupCandidates.length})</span>
              </label>
              <div className="ws-wakeup-footer__row">
                <Button
                  type="button"
                  variant="primary"
                  icon={<Power size={18} weight="bold" aria-hidden="true" />}
                  disabled={!isAdmin || wakeupChecked.size === 0 || wakeupDrawerMutation.isPending}
                  title={!isAdmin ? 'Chỉ quản trị viên được thực hiện' : undefined}
                  onClick={() => wakeupDrawerMutation.mutate([...wakeupChecked])}
                >
                  Mở máy trạm đã chọn ({wakeupChecked.size})
                </Button>
                <Button
                  type="button"
                  variant="danger-outline"
                  icon={<TrashSimple size={18} weight="bold" aria-hidden="true" />}
                  disabled={!isAdmin || wakeupChecked.size === 0}
                  title={!isAdmin ? 'Chỉ quản trị viên được thực hiện' : undefined}
                  onClick={() => setDeactivateConfirmOpen(true)}
                >
                  Xoá máy đã chọn ({wakeupChecked.size})
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <div className="ws-wait-panel">
          {registeredQuery.isLoading ? (
            <StateView title="Đang tải danh sách máy" />
          ) : registeredQuery.isError ? (
            <StateView
              title="Không tải được danh sách máy"
              description={(registeredQuery.error as Error).message}
              action={<Button onClick={() => registeredQuery.refetch()}>Thử lại</Button>}
            />
          ) : offCandidates.length === 0 ? (
            <StateView
              title="Không có máy đang tắt"
              description="Mọi máy đã đăng ký đều đang kết nối."
            />
          ) : (
            <>
              <div className="ds-field ws-search">
                <span className="ds-field__label ds-visually-hidden">Tìm nhanh</span>
                <div className="ds-input-group ds-input-group--search">
                  <div className="ds-search-input">
                    <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                    <input
                      className="ds-input"
                      type="search"
                      value={wakeupSearch}
                      placeholder="Tìm tên máy hoặc nhóm máy"
                      onChange={(event) => setWakeupSearch(event.target.value)}
                    />
                  </div>
                </div>
              </div>
              {visibleWakeupCandidates.length === 0 ? (
                <StateView
                  title="Không tìm thấy máy phù hợp"
                  description="Thử từ khoá khác."
                />
              ) : (
                <div className="ws-wait-list ws-wakeup-scroll">
                  {visibleWakeupCandidates.map((machine) => {
                    const groupName = groupsQuery.data?.find((g) => g.id === machine.machineGroupId)?.name
                    const lastResult = wakeupResults.find((r) => r.hostName === machine.hostName)
                    return (
                      <article key={machine.hostName} className="ws-wait-card">
                        <header>
                          <label className="ws-wait-card__select">
                            <input
                              type="checkbox"
                              checked={wakeupChecked.has(machine.hostName)}
                              onChange={() => toggleWakeupChecked(machine.hostName)}
                            />
                            <div>
                              <strong>{machine.hostName}</strong>
                              <span>{groupName ?? 'Chưa gán nhóm'}</span>
                            </div>
                          </label>
                        </header>
                        {lastResult ? (
                          <InlineAlert tone={lastResult.ok ? 'success' : 'warning'}>
                            {lastResult.ok ? 'Đã gửi lệnh mở máy trạm.' : `Lỗi: ${lastResult.reason}`}
                          </InlineAlert>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </Drawer>

      <ConfirmAction
        open={deactivateConfirmOpen}
        title="Vô hiệu hoá máy trạm"
        description={`Vô hiệu hoá ${wakeupChecked.size} máy đã chọn? Máy sẽ không còn hiện trong danh sách bật từ xa cho tới khi máy kết nối lại.`}
        confirmLabel="Vô hiệu hoá"
        danger
        pending={deactivateMutation.isPending}
        onCancel={() => setDeactivateConfirmOpen(false)}
        onConfirm={() => deactivateMutation.mutate([...wakeupChecked])}
      />

      <ConfirmAction
        open={Boolean(payoutWaitLog)}
        title="Tính tiền phiên chờ"
        description={payoutWaitLog ? `${payoutWaitLog.machineName} · Phiên #${payoutWaitLog.id}` : undefined}
        confirmLabel="Tính tiền"
        pending={paymentWaitPayoutMutation.isPending}
        onCancel={() => {
          paymentWaitPayoutIntent.clearKey()
          setPayoutWaitLog(null)
        }}
        onConfirm={() => {
          if (payoutWaitLog) paymentWaitPayoutMutation.mutate(payoutWaitLog)
        }}
      >
        <div className="ws-dialog-stack">
          <InlineAlert tone="info">
            Phí sẽ được máy chủ tính lại và chống thu hai lần bằng mã giao dịch hiện tại.
          </InlineAlert>
          {payoutWaitLog ? (
            <dl className="ws-detail-list">
              <div><dt>Phí thời gian snapshot</dt><dd>{formatMoney(payoutWaitLog.totalTimeFee)}</dd></div>
              <div><dt>Người thao tác</dt><dd>{staffName || '—'}</dd></div>
            </dl>
          ) : null}
        </div>
      </ConfirmAction>

      <Dialog
        open={Boolean(continueWaitLog)}
        title="Dùng tiếp trên máy khác"
        description={continueWaitLog ? `${continueWaitLog.machineName} · Phiên #${continueWaitLog.id}` : undefined}
        size="sm"
        onClose={() => {
          if (paymentWaitContinueMutation.isPending) return
          paymentWaitContinueIntent.clearKey()
          setContinueWaitLog(null)
          setContinueTarget('')
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={paymentWaitContinueMutation.isPending}
              onClick={() => {
                paymentWaitContinueIntent.clearKey()
                setContinueWaitLog(null)
                setContinueTarget('')
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={paymentWaitContinueMutation.isPending}
              disabled={!continueTarget}
              onClick={() => paymentWaitContinueMutation.mutate()}
            >
              Chuyển phiên
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <label className="ds-field">
            <span className="ds-field__label">Máy mới đang Sẵn sàng</span>
            <Select
              className="ds-select"
              value={continueTarget}
              onChange={(event) => setContinueTarget(event.target.value)}
            >
              <option value="">Chọn máy</option>
              {availableMachines.map((machine) => (
                <option key={machine.hostName} value={machine.hostName}>
                  {machine.hostName} · {machine.machineGroupName || `Nhóm ${machine.machineGroupId}`}
                </option>
              ))}
            </Select>
          </label>
          <InlineAlert tone="warning">
            Dịch vụ và phiên chờ sẽ được chuyển đúng theo mã phiên; máy cũ không còn giữ phiên.
          </InlineAlert>
        </div>
      </Dialog>

      <ConfirmAction
        open={Boolean(pendingCommand)}
        title={pendingCommand ? COMMANDS[pendingCommand].label : 'Xác nhận lệnh'}
        description={pendingCommand ? COMMANDS[pendingCommand].description : undefined}
        confirmLabel={pendingCommand ? COMMANDS[pendingCommand].confirmLabel : 'Xác nhận'}
        danger={pendingCommand ? COMMANDS[pendingCommand].danger : false}
        pending={commandMutation.isPending}
        onCancel={() => setPendingCommand(null)}
        onConfirm={() => {
          if (pendingCommand) {
            commandMutation.mutate({
              kind: pendingCommand,
              hostNames: selectedMachines.map((machine) => machine.hostName),
            })
          }
        }}
      >
        <div className="ws-confirm-targets">
          <span>Đích thực hiện</span>
          <strong>{selectedMachines.map((machine) => machine.hostName).join(', ')}</strong>
        </div>
      </ConfirmAction>

      <Dialog
        open={groupDialogOpen}
        title="Đổi nhóm máy"
        description={`Áp dụng cho ${selectedMachines.length} máy đã chọn.`}
        size="sm"
        onClose={() => setGroupDialogOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={groupMutation.isPending} onClick={() => setGroupDialogOpen(false)}>Hủy</Button>
            <Button type="button" variant="primary" loading={groupMutation.isPending} disabled={!targetGroupId} onClick={() => groupMutation.mutate()}>Đổi nhóm</Button>
          </>
        }
      >
        <label className="ds-field">
          <span className="ds-field__label">Nhóm mới</span>
          <Select className="ds-select" value={targetGroupId} onChange={(event) => setTargetGroupId(Number(event.target.value))}>
            <option value={0}>Chọn nhóm máy</option>
            {(groupsQuery.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
        </label>
      </Dialog>

      <Dialog
        open={noteDialogOpen}
        title="Ghi chú và giữ máy"
        description={`Áp dụng cho ${noteTargets.length} máy: ${noteTargets.join(', ')}`}
        size="sm"
        onClose={() => setNoteDialogOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={noteMutation.isPending} onClick={() => setNoteDialogOpen(false)}>Hủy</Button>
            <Button type="button" variant="primary" loading={noteMutation.isPending} onClick={() => noteMutation.mutate()}>Lưu thay đổi</Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <label className="ds-field">
            <span className="ds-field__label">Ghi chú</span>
            <textarea className="ds-input ws-note-input" maxLength={100} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label className="ws-check"><input type="checkbox" checked={lockLogin} onChange={(event) => setLockLogin(event.target.checked)} /> Giữ máy, không cho khách đăng nhập</label>
          <label className="ws-check"><input type="checkbox" checked={showLockScreen} onChange={(event) => setShowLockScreen(event.target.checked)} /> Hiện ghi chú trên màn hình khóa</label>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(moneyAction)}
        title={
          moneyAction === 'deposit' ? 'Nạp tiền hội viên'
            : moneyAction === 'giveFree' ? 'Tặng tiền'
              : moneyAction === 'credit' ? 'Cho mượn tiền'
                : moneyAction === 'suspend' ? 'Đưa phiên vào chờ tính tiền'
                  : moneyAction === 'payDebit' ? 'Thanh toán phí chuyển đến'
                    : 'Tính tiền phiên máy'
        }
        description={inspectedMachine ? `${inspectedMachine.hostName} · ${inspectedMachine.userName || 'Khách vãng lai'}` : undefined}
        size="sm"
        onClose={closeMoneyDialog}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={moneyMutation.isPending || depositQrActive}
              onClick={closeMoneyDialog}
            >
              Hủy
            </Button>
            {moneyAction !== 'deposit' || depositMethod !== 'qr' ? (
              <Button
                type="button"
                variant="primary"
                loading={moneyMutation.isPending}
                disabled={
                  (moneyAction === 'deposit' &&
                    !canSubmitDeposit(
                      depositMethod,
                      moneyAmount,
                      hasRight(RIGHTS.INPUT_NEGATIVE_MONEY),
                    )) ||
                  (moneyAction === 'giveFree' && (!moneyAmount || moneyAmount <= 0)) ||
                  (moneyAction === 'credit' && (!moneyAmount || moneyAmount <= 0))
                }
                onClick={() => moneyMutation.mutate()}
              >
                {moneyAction === 'deposit'
                  ? moneyAmount && moneyAmount < 0
                    ? depositMethod === 'transfer'
                      ? 'Xác nhận rút chuyển khoản'
                      : 'Xác nhận rút tiền mặt'
                    : depositMethod === 'transfer'
                      ? 'Xác nhận nạp chuyển khoản'
                      : 'Xác nhận nạp tiền mặt'
                  : 'Xác nhận giao dịch'}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="ws-dialog-stack">
          {moneyAction === 'deposit' && exactUser ? (
            <>
              <dl className="ws-detail-list">
                <div><dt>Người nhận</dt><dd>{exactUser.userName}</dd></div>
                <div><dt>Số dư trước</dt><dd>{formatMoney(exactUser.moneyMain)}</dd></div>
              </dl>
              <DepositAmountPanel
                value={moneyAmount}
                disabled={moneyMutation.isPending || depositQrActive}
                allowNegative={hasRight(RIGHTS.INPUT_NEGATIVE_MONEY)}
                onIntentChange={moneyIntent.clearKey}
                onChange={setMoneyAmount}
              />
              <DepositMethodSelector
                value={depositMethod}
                disabled={moneyMutation.isPending || depositQrActive}
                onChange={(method) => {
                  moneyIntent.clearKey()
                  setDepositMethod(method)
                }}
              />
              {depositMethod === 'cash' ? (
                <InlineAlert tone="info">
                  {moneyAmount && moneyAmount < 0
                    ? 'Số tiền âm là thao tác rút; máy chủ vẫn kiểm tra quyền và số dư khả dụng.'
                    : 'Tiền mặt dùng contract hiện tại và được ghi nhận ngay sau khi xác nhận.'}
                </InlineAlert>
              ) : depositMethod === 'qr' ? (
                <DepositQrFlow
                  userId={exactUser.userId}
                  amount={moneyAmount}
                  disabled={moneyMutation.isPending}
                  onActiveChange={setDepositQrActive}
                  onDone={({ amount: paid }) =>
                    depositPrint.print({
                      username: exactUser.userName,
                      amount: paid,
                      method: 'qr',
                      machine: inspectedMachine?.hostName,
                    })
                  }
                />
              ) : (
                <InlineAlert tone="info">
                  {moneyAmount && moneyAmount < 0
                    ? 'Số tiền âm ghi nhận khoản rút/hoàn qua chuyển khoản; máy chủ vẫn kiểm tra quyền và số dư.'
                    : 'Chỉ xác nhận sau khi đã đối soát khoản chuyển. Giao dịch được ghi đúng loại Chuyển khoản trên máy chủ.'}
                </InlineAlert>
              )}
              {depositPrint.optionBlock}
              <div className="ws-money-preview">
                <span>Số dư dự kiến sau giao dịch</span>
                <strong>{formatMoney(exactUser.moneyMain + (moneyAmount ?? 0))}</strong>
              </div>
              <div className="ws-operator">
                <span>Phương thức</span>
                <strong>{getDepositMethodOption(depositMethod).label}</strong>
              </div>
            </>
          ) : moneyAction === 'giveFree' ? (
            <>
              <dl className="ws-detail-list">
                <div><dt>Người nhận</dt><dd>{exactUser?.userName ?? inspectedMachine?.userName ?? '—'}</dd></div>
                {exactUser ? (
                  <div><dt>Số dư tặng trước</dt><dd>{formatMoney(exactUser.moneySub)}</dd></div>
                ) : null}
              </dl>
              <MoneyInput
                label="Số tiền"
                value={moneyAmount}
                min={1_000}
                onChange={(value) => {
                  moneyIntent.clearKey()
                  setMoneyAmount(value)
                }}
              />
              {exactUser ? (
                <div className="ws-money-preview">
                  <span>Số dư dự kiến sau giao dịch</span>
                  <strong>{formatMoney(exactUser.moneySub + (moneyAmount ?? 0))}</strong>
                </div>
              ) : null}
            </>
          ) : moneyAction === 'credit' ? (
            <>
              <dl className="ws-detail-list">
                <div><dt>Người mượn</dt><dd>{exactUser?.userName ?? inspectedMachine?.userName ?? '—'}</dd></div>
                {exactUser ? (
                  <div><dt>Nợ hiện tại</dt><dd>{formatMoney(exactUser.debit)}</dd></div>
                ) : null}
              </dl>
              <MoneyInput
                label="Số tiền cho mượn"
                value={moneyAmount}
                min={1_000}
                onChange={(value) => {
                  moneyIntent.clearKey()
                  setMoneyAmount(value)
                }}
                hint="Máy chủ kiểm tra hạn mức tín dụng (CreditLimit) trước khi ghi nợ."
              />
              {exactUser ? (
                <div className="ws-money-preview">
                  <span>Nợ dự kiến sau giao dịch</span>
                  <strong>{formatMoney(exactUser.debit + (moneyAmount ?? 0))}</strong>
                </div>
              ) : null}
            </>
          ) : moneyAction === 'suspend' ? (
            <InlineAlert tone="warning">
              Phiên trả sau sẽ rời máy hiện tại và xuất hiện trong danh sách Chờ tính tiền.
            </InlineAlert>
          ) : null}
          {/* Nạp tiền KHÔNG có ô ghi chú (parity MFC); ghi chú của phiếu in cấu hình ở khối "In phiếu nạp tiền". */}
          {moneyAction !== 'giveFree' && moneyAction !== 'credit' && moneyAction !== 'deposit' ? (
            <label className="ds-field">
              <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
              <input className="ds-input" maxLength={100} value={moneyNote} onChange={(event) => setMoneyNote(event.target.value)} />
            </label>
          ) : null}
          <div className="ws-operator">
            <span>Người thao tác</span>
            <strong>{staffName || '—'}</strong>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={anonymInfoOpen}
        title="Thông tin khách vãng lai"
        description={inspectedMachine ? inspectedMachine.hostName : undefined}
        size="sm"
        onClose={() => {
          if (anonymUpdateMutation.isPending || anonymAssignMutation.isPending || anonymCreateAssignMutation.isPending) return
          setAnonymInfoOpen(false)
        }}
        footer={
          assignedAnonymId ? (
            <>
              <Button type="button" variant="secondary" disabled={anonymUpdateMutation.isPending} onClick={() => setAnonymInfoOpen(false)}>
                Hủy
              </Button>
              <Button type="button" variant="primary" loading={anonymUpdateMutation.isPending} onClick={() => anonymUpdateMutation.mutate()}>
                Lưu
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={anonymCreateAssignMutation.isPending} onClick={() => setAnonymInfoOpen(false)}>
                Hủy
              </Button>
              <Button type="button" variant="primary" loading={anonymCreateAssignMutation.isPending} onClick={() => anonymCreateAssignMutation.mutate()}>
                Tạo &amp; gán
              </Button>
            </>
          )
        }
      >
        <div className="ws-dialog-stack">
          {anonymDraftError ? <InlineAlert tone="danger">{anonymDraftError}</InlineAlert> : null}

          {!assignedAnonymId ? (
            <>
              <label className="ds-field">
                <span className="ds-field__label">Tìm khách đã có hồ sơ</span>
                <div className="ds-input-group ds-input-group--search">
                  <div className="ds-search-input">
                    <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                    <input
                      className="ds-input"
                      type="search"
                      value={anonymSearch}
                      placeholder="Nhập họ tên cần tìm..."
                      onChange={(event) => setAnonymSearch(event.target.value)}
                    />
                  </div>
                </div>
              </label>
              {anonymSearchQuery.isLoading ? (
                <p className="ws-muted">Đang tìm…</p>
              ) : (anonymSearchQuery.data ?? []).length === 0 ? (
                <p className="ws-muted">Không tìm thấy hồ sơ phù hợp.</p>
              ) : (
                <div className="ws-wait-list">
                  {(anonymSearchQuery.data ?? []).map((customer) => (
                    <article key={customer.id} className="ws-wait-card">
                      <header>
                        <div>
                          <strong>{customer.name}</strong>
                          <span>CCCD {maskIdCard(customer.idCard)}</span>
                        </div>
                      </header>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={anonymAssignMutation.isPending}
                        onClick={() => anonymAssignMutation.mutate(customer.id)}
                      >
                        Chọn
                      </Button>
                    </article>
                  ))}
                </div>
              )}
              <InlineAlert tone="info">Hoặc tạo hồ sơ mới rồi gán cho máy này:</InlineAlert>
            </>
          ) : null}

          <label className="ds-field">
            <span className="ds-field__label">Họ tên</span>
            <input
              className="ds-input"
              type="text"
              maxLength={255}
              value={anonymDraft.name}
              onChange={(event) => setAnonymDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Số CCCD</span>
            <input
              className="ds-input"
              type="text"
              inputMode="numeric"
              maxLength={255}
              value={anonymDraft.idCard}
              onChange={(event) => setAnonymDraft((current) => ({ ...current, idCard: event.target.value }))}
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Địa chỉ</span>
            <textarea
              className="ds-input ws-note-input"
              maxLength={255}
              value={anonymDraft.address}
              onChange={(event) => setAnonymDraft((current) => ({ ...current, address: event.target.value }))}
            />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={changePcOpen}
        title="Chuyển hoặc hoán đổi máy"
        description={inspectedMachine ? `Phiên hiện tại tại ${inspectedMachine.hostName}` : undefined}
        size="sm"
        onClose={() => {
          if (changePcMutation.isPending) return
          changePcIntent.clearKey()
          setChangePcOpen(false)
          setChangePcTarget('')
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={changePcMutation.isPending}
              onClick={() => {
                changePcIntent.clearKey()
                setChangePcOpen(false)
                setChangePcTarget('')
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={changePcMutation.isPending}
              disabled={!changePcTarget}
              onClick={() => changePcMutation.mutate()}
            >
              {changePcMode === 'change' ? 'Chuyển phiên' : 'Hoán đổi máy'}
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <fieldset className="ws-choice-group">
            <legend>Kiểu chuyển</legend>
            <label>
              <input
                type="radio"
                name="change-pc-mode"
                value="change"
                checked={changePcMode === 'change'}
                onChange={() => {
                  changePcIntent.clearKey()
                  setChangePcMode('change')
                  setChangePcTarget('')
                }}
              />
              <span>
                <strong>Chuyển sang máy trống</strong>
                <small>Máy đích phải ở trạng thái Sẵn sàng.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="change-pc-mode"
                value="swap"
                checked={changePcMode === 'swap'}
                onChange={() => {
                  changePcIntent.clearKey()
                  setChangePcMode('swap')
                  setChangePcTarget('')
                }}
              />
              <span>
                <strong>Hoán đổi hai máy</strong>
                <small>Máy đích phải có phiên đang chơi.</small>
              </span>
            </label>
          </fieldset>
          <label className="ds-field">
            <span className="ds-field__label">
              {changePcMode === 'change' ? 'Máy trống đích' : 'Máy đang chơi cần hoán đổi'}
            </span>
            <Select
              className="ds-select"
              value={changePcTarget}
              onChange={(event) => {
                changePcIntent.clearKey()
                setChangePcTarget(event.target.value)
              }}
            >
              <option value="">Chọn máy đích</option>
              {changePcTargets.map((machine) => (
                <option key={machine.hostName} value={machine.hostName}>
                  {machine.hostName} · {machine.userName || machine.machineGroupName || 'Không có khách'}
                </option>
              ))}
            </Select>
          </label>
          {changePcTargets.length === 0 ? (
            <InlineAlert tone="warning">
              Không có máy phù hợp với kiểu chuyển đang chọn.
            </InlineAlert>
          ) : null}
          <InlineAlert tone="info">
            Máy chủ sẽ chuyển phiên, dịch vụ và nhật ký liên quan trong một luồng được tuần tự hóa.
          </InlineAlert>
        </div>
      </Dialog>

      <Dialog
        open={prepaidOpen}
        title="Chuyển phiên sang trả trước"
        description={inspectedMachine ? `${inspectedMachine.hostName} · Khách vãng lai trả sau` : undefined}
        size="sm"
        onClose={() => {
          if (prepaidMutation.isPending) return
          prepaidIntent.clearKey()
          setPrepaidOpen(false)
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={prepaidMutation.isPending}
              onClick={() => {
                prepaidIntent.clearKey()
                setPrepaidOpen(false)
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={prepaidMutation.isPending}
              disabled={!prepaidAmount || prepaidAmount <= 0}
              onClick={() => prepaidMutation.mutate()}
            >
              Chuyển sang trả trước
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <MoneyInput
            label="Số tiền trả trước"
            value={prepaidAmount}
            min={1_000}
            onChange={(value) => {
              prepaidIntent.clearKey()
              setPrepaidAmount(value)
            }}
            hint="Máy chủ quy đổi số tiền thành thời gian theo bảng giá hiện hành."
          />
          <div className="ws-operator">
            <span>Người thao tác</span>
            <strong>{staffName || '—'}</strong>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={anonymLoginOpen !== null}
        title={anonymLoginOpen === 'prepaid' ? 'Đăng nhập khách (trả tiền trước)' : 'Đăng nhập khách (trả tiền sau)'}
        description={inspectedMachine ? `${inspectedMachine.hostName} · Khách vãng lai` : undefined}
        size="sm"
        onClose={() => {
          if (anonymLoginMutation.isPending) return
          anonymLoginIntent.clearKey()
          setAnonymLoginOpen(null)
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={anonymLoginMutation.isPending}
              onClick={() => {
                anonymLoginIntent.clearKey()
                setAnonymLoginOpen(null)
              }}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={anonymLoginMutation.isPending}
              disabled={
                !loginPriceId ||
                (anonymLoginOpen === 'prepaid' && (!loginChargeMoney || loginChargeMoney <= 0))
              }
              onClick={() => anonymLoginMutation.mutate()}
            >
              {anonymLoginOpen === 'prepaid' ? 'Đăng nhập trả trước' : 'Đăng nhập trả sau'}
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <label className="ds-field">
            <span className="ds-field__label">Nhóm giá</span>
            <Select
              className="ds-select"
              value={loginPriceId}
              onChange={(event) => {
                setLoginPriceId(event.target.value ? Number(event.target.value) : '')
                setLoginPriceAppRentId('')
              }}
            >
              <option value="">Chọn nhóm giá</option>
              {(loginOptionsQuery.data?.prices ?? []).map((price) => (
                <option key={price.priceId} value={price.priceId}>
                  {price.priceType} · {formatMoney(price.price)}
                </option>
              ))}
            </Select>
          </label>
          {(loginOptionsQuery.data?.priceAppRents.length ?? 0) > 0 ? (
            <label className="ds-field">
              <span className="ds-field__label">Gói ứng dụng thuê</span>
              <Select
                className="ds-select"
                value={loginPriceAppRentId}
                onChange={(event) =>
                  setLoginPriceAppRentId(event.target.value ? Number(event.target.value) : '')
                }
              >
                <option value="">Không áp dụng</option>
                {loginOptionsQuery.data?.priceAppRents.map((rent) => (
                  <option key={rent.id} value={rent.id}>
                    {rent.name} · {formatMoney(rent.price)}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {anonymLoginOpen === 'prepaid' ? (
            <MoneyInput
              label="Số tiền trả trước"
              value={loginChargeMoney}
              min={1_000}
              onChange={setLoginChargeMoney}
              hint="Máy chủ quy đổi số tiền thành thời gian theo bảng giá hiện hành."
            />
          ) : null}
          <div className="ws-operator">
            <span>Người thao tác</span>
            <strong>{staffName || '—'}</strong>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={messageDialogOpen}
        title="Nhắn tin tới máy trạm"
        description={`Gửi tới ${messageTargets.length} máy: ${messageTargets.join(', ')}`}
        size="sm"
        onClose={() => {
          if (messageMutation.isPending) return
          setMessageDialogOpen(false)
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={messageMutation.isPending}
              onClick={() => setMessageDialogOpen(false)}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={messageMutation.isPending}
              disabled={!messageText.trim()}
              onClick={() => messageMutation.mutate()}
            >
              Gửi tin nhắn
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <label className="ds-field">
            <span className="ds-field__label">Nội dung (tối đa 500 ký tự)</span>
            <textarea
              className="ds-input ws-note-input"
              maxLength={500}
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
            />
          </label>
          <InlineAlert tone="info">
            Tin nhắn hiện ngay trên màn hình máy khách đang online; máy ngoại tuyến sẽ báo
            "offline" trong kết quả. Không hiện lại trong cửa sổ chat MFC của thu ngân.
          </InlineAlert>
        </div>
      </Dialog>

      <Dialog
        open={appsDialogOpen}
        title="Ứng dụng đang chạy"
        description={inspectedMachine?.hostName}
        size="md"
        onClose={() => {
          if (closeAppMutation.isPending) return
          setAppsDialogOpen(false)
        }}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              loading={appsQueryMutation.isPending}
              onClick={() => inspectedMachine && appsQueryMutation.mutate(inspectedMachine.hostName)}
            >
              Làm mới
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={closeAppMutation.isPending}
              disabled={!hasRight(RIGHTS.CLOSE_ALL_APPS) || !appsList || appsList.length === 0}
              title={!hasRight(RIGHTS.CLOSE_ALL_APPS) ? `Thiếu quyền ${RIGHTS.CLOSE_ALL_APPS}` : undefined}
              onClick={() => closeAppMutation.mutate({ all: true })}
            >
              Đóng tất cả
            </Button>
          </>
        }
      >
        <div className="ws-dialog-stack">
          <InlineAlert tone="warning">
            Mở danh sách này sẽ hiện một cửa sổ chặn màn hình MFC tại quầy tới khi có người đóng —
            chỉ dùng khi cần, đừng bấm lặp lại nhiều lần.
          </InlineAlert>
          {appsQueryMutation.isPending ? <StateView title="Đang lấy danh sách ứng dụng…" /> : null}
          {appsError ? (
            <StateView
              title="Không lấy được danh sách"
              description={appsError}
              action={
                <Button
                  onClick={() => inspectedMachine && appsQueryMutation.mutate(inspectedMachine.hostName)}
                >
                  Thử lại
                </Button>
              }
            />
          ) : null}
          {!appsQueryMutation.isPending && !appsError && appsList && appsList.length === 0 ? (
            <StateView title="Không có ứng dụng nào đang chạy" />
          ) : null}
          {appsList && appsList.length > 0 ? (
            <ul className="ws-apps-list">
              {appsList.map((app) => (
                <li key={app.pid} className="ws-apps-list__row">
                  <div>
                    <strong>{app.title || `PID ${app.pid}`}</strong>
                    <small>{app.filePath || '—'}</small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!app.closable || !hasRight(RIGHTS.CLOSE_ALL_APPS) || closeAppMutation.isPending}
                    title={
                      !app.closable
                        ? 'Máy chủ chặn đóng ứng dụng này'
                        : !hasRight(RIGHTS.CLOSE_ALL_APPS)
                          ? `Thiếu quyền ${RIGHTS.CLOSE_ALL_APPS}`
                          : undefined
                    }
                    onClick={() => closeAppMutation.mutate({ app })}
                  >
                    Đóng
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Dialog>

      {/* Gọi món hộ từ drawer chi tiết máy: máy đang xem được chọn sẵn. "In phiếu" ẩn hộp thoại gọi món
          trong lúc in (không xếp chồng 2 modal) nhưng giữ state — cùng cách trang /orders làm. */}
      <StaffOrderDialog
        open={staffOrderOpen && printDetailIds === null}
        presetHostName={inspectorHost}
        defaultMode="machine"
        onClose={() => setStaffOrderOpen(false)}
        onPrint={(detailIds) => setPrintDetailIds(detailIds)}
      />
      <PrintTicketDialog detailIds={printDetailIds} onClose={() => setPrintDetailIds(null)} />
      {depositPrint.retryDialog}
    </section>
  )
}
