import {  useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getMachineGroups } from '../../api/machine-groups'
import { getPaymentWaitLogs, type PaymentWaitLog } from '../../api/logs'
import { getUsers, usersApi, type UserAccount } from '../../api/users'
import {
  adminLoginWorkstations,
  bulkChangeWorkstationGroup,
  closeAppWorkstations,
  continuePaymentWait,
  changeSessionToPrepaid,
  changeWorkstationPc,
  hibernateWorkstations,
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
  InlineAlert,
  MoneyInput,
  PageHeader,
  StateView,
  StatusBadge,
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
import { ClientSystemFunctionDialog } from './ClientSystemFunctionDialog'
import { ScheduledShutdownDialog } from './ScheduledShutdownDialog'
import {
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
} as const

// UserGroupTypeCode (api/user-groups.ts): 1=anonym 2=member 3=admin 4=staff 5=combo
const USER_GROUP_TYPE = {
  anonym: 1,
  member: 2,
  combo: 5,
} as const

type CommandKind =
  | 'logout'
  | 'restart'
  | 'shutdown'
  | 'hibernate'
  | 'closeApp'
  | 'adminLogin'
  | 'update'

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
}

const COMMANDS: Record<CommandKind, CommandDefinition> = {
  logout: {
    label: 'Đăng xuất',
    confirmLabel: 'Đăng xuất máy',
    description: 'Kết thúc phiên đăng nhập trên các máy đã chọn.',
    danger: true,
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
  hibernate: {
    label: 'Ngủ đông',
    confirmLabel: 'Cho máy ngủ đông',
    description: 'Gửi lệnh ngủ đông. Chức năng này chỉ dành cho quản trị viên.',
    adminOnly: true,
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
    label: 'Cập nhật client',
    confirmLabel: 'Gửi lệnh cập nhật',
    description: 'Yêu cầu client trên các máy đã chọn cập nhật phiên bản.',
    adminOnly: true,
  },
}

type MoneyAction =
  | 'payout'
  | 'payoutPrepaid'
  | 'payDebit'
  | 'suspend'
  | 'deposit'
  | 'giveFree'

type ChangePcMode = 'change' | 'swap'

function executeCommand({ kind, hostNames }: CommandRequest) {
  switch (kind) {
    case 'logout':
      return logoutWorkstations({ hostNames })
    case 'restart':
      return restartWorkstations({ hostNames })
    case 'shutdown':
      return shutdownWorkstations({ hostNames })
    case 'hibernate':
      return hibernateWorkstations({ hostNames })
    case 'closeApp':
      return closeAppWorkstations({ hostNames })
    case 'adminLogin':
      return adminLoginWorkstations({ hostNames })
    case 'update':
      return updateWorkstationsVersion({ hostNames })
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

export function WorkstationWorkspace() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const connected = useWsStatusStore((state) => state.connected)
  const hasRight = useAuthStore((state) => state.hasRight)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const staffName = useAuthStore((state) => state.staffName)
  const setOrderHost = useOrderQueueStore((state) => state.setHostName)
  const setOrderUser = useOrderQueueStore((state) => state.setSelectedUserId)

  const snapshotQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    refetchInterval: connected ? 30_000 : 5_000,
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inspectorHost, setInspectorHost] = useState<string | null>(null)
  const [pendingCommand, setPendingCommand] = useState<CommandKind | null>(null)
  const [commandResults, setCommandResults] = useState<WsControlResult[]>([])
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
  const [payoutWaitLog, setPayoutWaitLog] = useState<PaymentWaitLog | null>(null)
  const [continueWaitLog, setContinueWaitLog] = useState<PaymentWaitLog | null>(null)
  const [continueTarget, setContinueTarget] = useState('')
  const [changePcOpen, setChangePcOpen] = useState(false)
  const [changePcMode, setChangePcMode] = useState<ChangePcMode>('change')
  const [changePcTarget, setChangePcTarget] = useState('')
  const [prepaidOpen, setPrepaidOpen] = useState(false)
  const [prepaidAmount, setPrepaidAmount] = useState<number | null>(20_000)
  const [systemFunctionsOpen, setSystemFunctionsOpen] = useState(false)
  const [shutdownScheduleOpen, setShutdownScheduleOpen] = useState(false)
  const [messageDialogOpen, setMessageDialogOpen] = useState(false)
  const [messageTargets, setMessageTargets] = useState<string[]>([])
  const [messageText, setMessageText] = useState('')
  const [appsDialogOpen, setAppsDialogOpen] = useState(false)
  const [appsList, setAppsList] = useState<WorkstationApp[] | null>(null)
  const [appsError, setAppsError] = useState<string | null>(null)
  const moneyIntent = useIdempotentIntent('workstation-workspace-money')
  const paymentWaitPayoutIntent = useIdempotentIntent('payment-wait-payout')
  const paymentWaitContinueIntent = useIdempotentIntent('payment-wait-continue')
  const changePcIntent = useIdempotentIntent('workstation-change-pc')
  const prepaidIntent = useIdempotentIntent('workstation-change-prepaid')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...optionalColumns]))
  }, [optionalColumns])

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

  const selectedMachines = useMemo(
    () => allMachines.filter((machine) => selected.has(machine.hostName)),
    [allMachines, selected],
  )
  const inspectedMachine =
    allMachines.find((machine) => machine.hostName === inspectorHost) ?? null
  const status = inspectedMachine ? getWorkstationStatus(inspectedMachine) : null
  const flags = inspectedMachine ? getWorkstationFlags(inspectedMachine) : []
  const clock = inspectedMachine
    ? interpolateSession(inspectedMachine, elapsedSeconds)
    : { used: null, remaining: null }

  const userQuery = useQuery({
    queryKey: ['workstation-user', inspectedMachine?.userId, inspectedMachine?.userName],
    queryFn: () => getUsers('member', 20, 0, inspectedMachine?.userName ?? ''),
    enabled: Boolean(inspectedMachine?.userId && inspectedMachine?.userName),
  })
  const exactUser = getExactUser(userQuery.data?.items, inspectedMachine)
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
      setCommandResults(results)
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      setPendingCommand(null)
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
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
      setCommandResults(results)
      setGroupDialogOpen(false)
      pushToast(resultMessage(results), results.every((item) => item.ok) ? 'success' : 'info')
      void queryClient.invalidateQueries({ queryKey: ['workstations'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const noteMutation = useMutation({
    mutationFn: () =>
      updateWorkstationNote({
        hostNames: selectedMachines.map((machine) => machine.hostName),
        note: note.trim(),
        lockLogin,
        showLockScreen,
      }),
    onSuccess: ({ results, fn1 }) => {
      setCommandResults(results)
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
      setCommandResults(results)
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
            machine: inspectedMachine.hostName,
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
            note: moneyNote.trim() || undefined,
            idem,
          })
        case 'giveFree':
          if (!exactUser || !moneyAmount) throw new Error('Số tiền tặng không hợp lệ')
          return usersApi.giveFree({
            userId: exactUser.userId,
            giveMoney: moneyAmount,
            idem,
          })
      }
    },
    onSuccess: () => {
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

  const openInspector = (machine: WorkstationRuntime) => {
    setInspectorHost(machine.hostName)
  }

  const openMessageDialog = (hostNames: string[]) => {
    setMessageTargets(hostNames)
    setMessageText('')
    setMessageDialogOpen(true)
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
  const groupUsage = (groupsQuery.data ?? [])
    .map((group) => {
      const groupMachines = allMachines.filter((machine) => machine.machineGroupId === group.id)
      const inUse = groupMachines.filter((machine) => machine.status === WORKSTATION_STATUS.ONLINE).length
      const total = groupMachines.length
      return { id: group.id, name: group.name, inUse, total, percent: total > 0 ? Math.round((inUse / total) * 100) : 0 }
    })
    .sort((left, right) => right.inUse - left.inUse)
  const overallUsagePercent = allMachines.length > 0 ? Math.round((counts.playing / allMachines.length) * 100) : 0
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
            <StatusBadge tone={connected ? 'success' : 'warning'}>
              {connected ? 'Realtime đã kết nối' : 'Đang dùng polling'}
            </StatusBadge>
            <Button
              type="button"
              variant={(paymentWaitQuery.data?.length ?? 0) > 0 ? 'primary' : 'secondary'}
              onClick={() => {
                setInspectorHost(null)
                setPaymentWaitOpen(true)
              }}
            >
              Chờ tính tiền ({paymentWaitQuery.data?.length ?? 0})
            </Button>
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
              disabled={!hasRight(RIGHTS.SHUTDOWN_ALL)}
              title={!hasRight(RIGHTS.SHUTDOWN_ALL) ? `Thiếu quyền ${RIGHTS.SHUTDOWN_ALL}` : undefined}
              onClick={() => setShutdownScheduleOpen(true)}
            >
              Lịch tắt máy
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={snapshotQuery.isFetching}
              onClick={() => snapshotQuery.refetch()}
            >
              Làm mới
            </Button>
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
            <div className="ws-summary__total">
              <span>Khu vực</span>
              <strong>{overallUsagePercent}%</strong>
            </div>
            <div className="ws-group-usage__breakdown">
              {groupUsage.map((group) => (
                <div key={group.id} className="ws-group-usage__row">
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
                  </div>
                  <span className="ws-group-usage__percent">{group.percent}%</span>
                </div>
              ))}
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
        <label className="ds-field ws-search">
          <span className="ds-field__label ds-visually-hidden">Tìm nhanh</span>
          <input
            className="ds-input"
            type="search"
            value={search}
            placeholder="Tên máy, IP, khách hàng hoặc ghi chú"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
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
            <Button type="button" variant="secondary" onClick={() => openCommand('logout')}>
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
            <Button type="button" variant="secondary" onClick={() => setNoteDialogOpen(true)}>
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

      {commandResults.length > 0 ? (
        <div className="ws-results">
          <InlineAlert tone={commandResults.every((item) => item.ok) ? 'success' : 'warning'}>
            {resultMessage(commandResults)}. Xem kết quả từng máy bên dưới.
          </InlineAlert>
          <details>
            <summary>Kết quả lệnh gần nhất</summary>
            <ul>
              {commandResults.map((result) => (
                <li key={result.hostName} className={result.ok ? 'is-success' : 'is-failed'}>
                  <strong>{result.hostName}</strong>
                  <span>{result.ok ? 'Thành công' : result.reason || 'Không thực hiện được'}</span>
                </li>
              ))}
            </ul>
          </details>
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
        ) : filteredMachines.length === 0 ? (
          <StateView
            title="Không có máy phù hợp"
            description="Hãy đổi bộ lọc hoặc từ khóa tìm kiếm."
            action={<Button onClick={() => { setSearch(''); setGroupId(0); setFilter('all') }}>Xóa bộ lọc</Button>}
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
          <div className="ws-inspector">
            <div className="ws-inspector__status">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              {flags.map((flag) => <StatusBadge key={flag.label} tone={flag.tone}>{flag.label}</StatusBadge>)}
            </div>

            <section className="ws-inspector__section">
              <h3>Phiên hiện tại</h3>
              <dl className="ws-detail-list">
                <div><dt>Khách hàng</dt><dd>{inspectedMachine.userName || '—'}</dd></div>
                <div><dt>Loại phiên</dt><dd>{sessionLabel(inspectedMachine.session)}</dd></div>
                <div><dt>Bắt đầu</dt><dd>{formatStartedAt(inspectedMachine.session?.startedAt)}</dd></div>
                <div><dt>Đã dùng</dt><dd>{formatDuration(clock.used)}</dd></div>
                <div><dt>Còn lại</dt><dd>{formatDuration(clock.remaining)}</dd></div>
                <div><dt>Phí tạm tính</dt><dd>{formatMoney(inspectedMachine.session?.totalAmount)}</dd></div>
                <div><dt>Số dư</dt><dd>{formatMoney(inspectedMachine.session?.remainingMoney)}</dd></div>
                <div><dt>Combo</dt><dd>{inspectedMachine.session?.comboName || '—'}</dd></div>
              </dl>
              {inspectedMachine.session ? (
                <div className="ws-action-grid">
                  <Button type="button" variant="primary" onClick={() => setMoneyAction(inspectedMachine.session?.prepaid ? 'payoutPrepaid' : 'payout')}>
                    Thu tiền
                  </Button>
                  {hasDebt(inspectedMachine) && inspectedMachine.userId > 0 ? (
                    <Button type="button" variant="secondary" onClick={() => setMoneyAction('payDebit')}>
                      Thanh toán phí chuyển
                    </Button>
                  ) : null}
                  {!inspectedMachine.session.prepaid && inspectedMachine.userId === 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!hasRight(RIGHTS.SUSPEND_MACHINE)}
                      title={!hasRight(RIGHTS.SUSPEND_MACHINE) ? `Thiếu quyền ${RIGHTS.SUSPEND_MACHINE}` : undefined}
                      onClick={() => setMoneyAction('suspend')}
                    >
                      Chờ tính tiền
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setChangePcMode('change')
                      setChangePcTarget('')
                      setChangePcOpen(true)
                    }}
                  >
                    Chuyển máy
                  </Button>
                  {!inspectedMachine.session.prepaid &&
                  inspectedMachine.userId === 0 &&
                  inspectedMachine.status === WORKSTATION_STATUS.ONLINE ? (
                    <Button
                      type="button"
                      variant="secondary"
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
            </section>

            {inspectedMachine.userId > 0 ? (
              <section className="ws-inspector__section">
                <h3>Khách hàng</h3>
                {userQuery.isLoading ? <p className="ws-muted">Đang tải số dư…</p> : null}
                {exactUser ? (
                  <>
                    <dl className="ws-detail-list">
                      <div><dt>Tài khoản</dt><dd>{exactUser.userName}</dd></div>
                      <div><dt>Số dư chính</dt><dd>{formatMoney(exactUser.moneyMain)}</dd></div>
                      <div><dt>Tiền tặng</dt><dd>{formatMoney(exactUser.moneySub)}</dd></div>
                    </dl>
                    <div className="ws-action-grid">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={!hasRight(RIGHTS.MODIFY_MONEY)}
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
                        type="button"
                        variant="secondary"
                        disabled={!hasRight(RIGHTS.MODIFY_MONEY)}
                        title={!hasRight(RIGHTS.MODIFY_MONEY) ? `Thiếu quyền ${RIGHTS.MODIFY_MONEY}` : undefined}
                        onClick={() => { setMoneyAmount(10_000); setMoneyAction('giveFree') }}
                      >
                        Tặng tiền
                      </Button>
                    </div>
                  </>
                ) : userQuery.isError ? (
                  <InlineAlert tone="warning">Không tải được hồ sơ hội viên; có thể mở trang Khách hàng để xử lý.</InlineAlert>
                ) : null}
              </section>
            ) : null}

            <section className="ws-inspector__section">
              <h3>Dịch vụ tại máy</h3>
              <Button
                type="button"
                variant="secondary"
                block
                onClick={() => {
                  setOrderHost(inspectedMachine.hostName)
                  setOrderUser(inspectedMachine.userId ? String(inspectedMachine.userId) : '')
                  navigate('/orders')
                }}
              >
                Mở hàng đợi gọi món
              </Button>
            </section>

            <section className="ws-inspector__section">
              <h3>Điều khiển phiên</h3>
              <div className="ws-action-grid">
                <Button type="button" variant="secondary" onClick={() => openCommand('logout', [inspectedMachine])}>Đăng xuất</Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(commandDisabledReason(COMMANDS.adminLogin, [inspectedMachine], hasRight, isAdmin))}
                  title={commandDisabledReason(COMMANDS.adminLogin, [inspectedMachine], hasRight, isAdmin) || undefined}
                  onClick={() => openCommand('adminLogin', [inspectedMachine])}
                >
                  Đăng nhập ADMIN
                </Button>
              </div>
            </section>

            <section className="ws-inspector__section">
              <h3>Điều khiển hệ thống</h3>
              <div className="ws-action-grid">
                {(['restart', 'closeApp', 'shutdown', 'hibernate', 'update'] as CommandKind[]).map((kind) => {
                  const definition = COMMANDS[kind]
                  const reason = commandDisabledReason(definition, [inspectedMachine], hasRight, isAdmin)
                  return (
                    <Button
                      key={kind}
                      type="button"
                      variant={kind === 'shutdown' ? 'danger' : 'secondary'}
                      disabled={Boolean(reason)}
                      title={reason || undefined}
                      onClick={() => openCommand(kind, [inspectedMachine])}
                    >
                      {definition.label}
                    </Button>
                  )
                })}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openMessageDialog([inspectedMachine.hostName])}
                >
                  Nhắn tin
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openAppsDialog(inspectedMachine)}
                >
                  Ứng dụng đang chạy
                </Button>
              </div>
              <InlineAlert tone="info">
                Âm lượng, xem màn hình và điều khiển từ xa đang chờ backend (2.22).
              </InlineAlert>
            </section>

            <section className="ws-inspector__section">
              <h3>Thông tin kỹ thuật</h3>
              <dl className="ws-detail-list">
                <div><dt>Phiên bản</dt><dd>{inspectedMachine.version || '—'}</dd></div>
                <div><dt>Ghi chú</dt><dd>{inspectedMachine.note || '—'}</dd></div>
                <div><dt>Cập nhật snapshot</dt><dd>{new Date(inspectedMachine.updatedAtMs).toLocaleTimeString('vi-VN')}</dd></div>
              </dl>
            </section>
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
                    <div><dt>Bắt đầu</dt><dd>{log.beginTime || '—'}</dd></div>
                    <div><dt>Kết thúc</dt><dd>{log.endTime || '—'}</dd></div>
                    <div><dt>Thời gian dùng</dt><dd>{formatDuration(log.totalTimeUsed)}</dd></div>
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
                      Thu tiền
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

      <ConfirmAction
        open={Boolean(payoutWaitLog)}
        title="Thu tiền phiên chờ"
        description={payoutWaitLog ? `${payoutWaitLog.machineName} · Phiên #${payoutWaitLog.id}` : undefined}
        confirmLabel="Thu tiền"
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
        description={`Áp dụng cho ${selectedMachines.length} máy đã chọn.`}
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
          <InlineAlert tone="info">Tùy chọn giữ/hiện màn hình chỉ có hiệu lực khi máy chủ bật tính năng FN1.</InlineAlert>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(moneyAction)}
        title={
          moneyAction === 'deposit' ? 'Nạp tiền hội viên'
            : moneyAction === 'giveFree' ? 'Tặng tiền hội viên'
              : moneyAction === 'suspend' ? 'Đưa phiên vào chờ tính tiền'
                : moneyAction === 'payDebit' ? 'Thanh toán phí chuyển đến'
                  : 'Thu tiền phiên máy'
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
                  (moneyAction === 'giveFree' && (!moneyAmount || moneyAmount <= 0))
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
          {(moneyAction === 'deposit' || moneyAction === 'giveFree') && exactUser ? (
            <>
              <dl className="ws-detail-list">
                <div><dt>Người nhận</dt><dd>{exactUser.userName}</dd></div>
                <div><dt>Số dư trước</dt><dd>{formatMoney(moneyAction === 'deposit' ? exactUser.moneyMain : exactUser.moneySub)}</dd></div>
              </dl>
              {moneyAction === 'deposit' ? (
                <DepositAmountPanel
                  value={moneyAmount}
                  disabled={moneyMutation.isPending || depositQrActive}
                  allowNegative={hasRight(RIGHTS.INPUT_NEGATIVE_MONEY)}
                  onIntentChange={moneyIntent.clearKey}
                  onChange={setMoneyAmount}
                />
              ) : (
                <MoneyInput
                  label="Số tiền"
                  value={moneyAmount}
                  min={1_000}
                  onChange={(value) => {
                    moneyIntent.clearKey()
                    setMoneyAmount(value)
                  }}
                />
              )}
              {moneyAction === 'deposit' ? (
                <>
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
                    />
                  ) : (
                    <InlineAlert tone="info">
                      {moneyAmount && moneyAmount < 0
                        ? 'Số tiền âm ghi nhận khoản rút/hoàn qua chuyển khoản; máy chủ vẫn kiểm tra quyền và số dư.'
                        : 'Chỉ xác nhận sau khi đã đối soát khoản chuyển. Giao dịch được ghi đúng loại Chuyển khoản trên máy chủ.'}
                    </InlineAlert>
                  )}
                </>
              ) : null}
              <div className="ws-money-preview">
                <span>Số dư dự kiến sau giao dịch</span>
                <strong>
                  {formatMoney(
                    (moneyAction === 'deposit' ? exactUser.moneyMain : exactUser.moneySub) +
                    (moneyAmount ?? 0),
                  )}
                </strong>
              </div>
              {moneyAction === 'deposit' ? (
                <div className="ws-operator">
                  <span>Phương thức</span>
                  <strong>{getDepositMethodOption(depositMethod).label}</strong>
                </div>
              ) : null}
            </>
          ) : (
            <InlineAlert tone={moneyAction === 'suspend' ? 'warning' : 'info'}>
              {moneyAction === 'suspend'
                ? 'Phiên trả sau sẽ rời máy hiện tại và xuất hiện trong danh sách Chờ tính tiền.'
                : 'Số tiền thanh toán được máy chủ tính lại từ dữ liệu phiên. Frontend không tự chốt hoặc sửa số tiền.'}
            </InlineAlert>
          )}
          {moneyAction !== 'giveFree' &&
          !(moneyAction === 'deposit' && depositMethod === 'qr') ? (
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
          <InlineAlert tone="warning">
            Thao tác sẽ chuyển voucher của phiên hiện tại; không tạo một giao dịch thanh toán giả ở frontend.
          </InlineAlert>
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

      <ClientSystemFunctionDialog
        open={systemFunctionsOpen}
        canManage={isAdmin}
        onClose={() => setSystemFunctionsOpen(false)}
      />

      <ScheduledShutdownDialog
        open={shutdownScheduleOpen}
        canManage={hasRight(RIGHTS.SHUTDOWN_ALL)}
        onClose={() => setShutdownScheduleOpen(false)}
      />
    </section>
  )
}
