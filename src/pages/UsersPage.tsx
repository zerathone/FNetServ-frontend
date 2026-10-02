import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowsClockwise,
  Broom,
  Coins,
  MagnifyingGlass,
  NotePencil,
  Printer,
  UserPlus,
  X,
} from '@phosphor-icons/react'
import { getUsers, usersApi, type UserAccount, type UserSearchField } from '../api/users'
import {
  Button,
  ConfirmAction,
  Dialog,
  Drawer,
  InlineAlert,
  ListPagination,
  ListToolbar,
  MoneyInput,
  PageHeader,
  RefreshButton,
  Select,
} from '../design-system/components'
import { AutoGenerateMemberDialog } from '../features/customers/AutoGenerateMemberDialog'
import { CreateUserDialog } from '../features/customers/CreateUserDialog'
import { CustomerInspector } from '../features/customers/CustomerInspector'
import { CredentialFilePrintDialog } from '../features/printers/CredentialFilePrintDialog'
import { DepositAmountPanel } from '../features/payments/DepositAmountPanel'
import { DepositMethodSelector } from '../features/payments/DepositMethodSelector'
import { DepositQrFlow } from '../features/payments/DepositQrFlow'
import {
  canSubmitDeposit,
  getDepositMethodOption,
  toDepositApiPaymentMethod,
  type DepositMethod,
} from '../features/payments/depositModel'
import { fingerprintIntent, useIdempotentIntent } from '../lib/idempotency'
import { invalidateMoneyQueries } from '../lib/fintechQueries'
import { useAuthStore } from '../store/auth'
import { pushToast } from '../store/toast'
import '../features/customers/customers.css'

type CustomerAction = 'deposit' | 'give' | 'credit' | 'payDebt' | 'transfer'

const RIGHTS = {
  GIVE_MONEY: 11,
  MONEY_TRANSFER: 25,
  INPUT_NEGATIVE_MONEY: 26,
} as const

// FIXBUG 2026-09-23: tìm theo ĐÚNG 1 trường. Gộp 3 trường = 3 lượt quét bảng hội viên ở BE.
// Tab staff/combo BE lọc in-memory theo tên đã giải mã, không nhận tham số `qby`.
const SEARCH_FIELD_LABELS: Record<UserSearchField, string> = {
  username: 'Tên đăng nhập',
  phone: 'Số điện thoại',
  idnumber: 'CCCD',
}
const SEARCH_FIELD_PLACEHOLDERS: Record<UserSearchField, string> = {
  username: 'Nhập từ đầu tên đăng nhập...',
  phone: 'Nhập từ đầu số điện thoại...',
  idnumber: 'Nhập từ đầu số CCCD...',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
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

function actionTitle(action: CustomerAction | null) {
  switch (action) {
    case 'deposit':  return 'Nạp tiền hội viên'
    case 'give':     return 'Tặng tiền hội viên'
    case 'credit':   return 'Cho mượn tiền'
    case 'payDebt':  return 'Thanh toán nợ'
    case 'transfer': return 'Chuyển tiền hội viên'
    default:         return 'Giao dịch hội viên'
  }
}

// ─── Column definitions ───────────────────────────────────────────────────────
type CustomerColumn =
  | 'userName' | 'name' | 'idNumber' | 'phone'
  | 'moneyPaid' | 'moneyUsed' | 'moneyRemain' | 'moneyMain' | 'moneySub'
  | 'groupName' | 'email' | 'note'

const CUSTOMER_COLUMNS: Array<{
  id: CustomerColumn; label: string; required?: boolean; width: string; money?: boolean
}> = [
  { id: 'userName',    label: 'Tên đăng nhập',   required: true, width: 'minmax(10rem, 1.15fr)' },
  { id: 'name',        label: 'Tên',              required: true, width: 'minmax(10rem, 1.2fr)' },
  { id: 'idNumber',    label: 'Số CCCD',                         width: '8.5rem' },
  { id: 'phone',       label: 'Điện thoại',                      width: '8.5rem' },
  { id: 'moneyPaid',   label: 'Số tiền nạp',                     width: '8rem',  money: true },
  { id: 'moneyUsed',   label: 'Số tiền đã dùng',                 width: '8rem',  money: true },
  { id: 'moneyRemain', label: 'Số tiền còn lại',                 width: '8.5rem',money: true },
  { id: 'moneyMain',   label: 'Tài khoản chính',                 width: '8.5rem',money: true },
  { id: 'moneySub',    label: 'Khuyến mãi',                      width: '8rem',  money: true },
  { id: 'groupName',   label: 'Nhóm người dùng',                 width: 'minmax(8rem, 1fr)' },
  { id: 'email',       label: 'Email',                           width: 'minmax(12rem, 1.35fr)' },
  { id: 'note',        label: 'Ghi chú',                         width: 'minmax(11rem, 1.25fr)' },
]

const DEFAULT_COLUMNS: CustomerColumn[] = [
  'userName', 'name', 'idNumber', 'phone',
  'moneyRemain', 'moneyMain', 'moneySub',
  'groupName', 'email', 'note',
]

function columnValue(user: UserAccount, col: CustomerColumn): string | number {
  switch (col) {
    case 'userName':    return user.userName
    case 'name':        return displayName(user)
    case 'idNumber':    return user.idNumber || ''
    case 'phone':       return user.phone || ''
    case 'moneyPaid':   return user.moneyPaid
    case 'moneyUsed':   return user.moneyUsed
    case 'moneyRemain': return user.moneyRemain
    case 'moneyMain':   return user.moneyMain
    case 'moneySub':    return user.moneySub
    case 'groupName':   return user.groupName || ''
    case 'email':       return user.email || ''
    case 'note':        return user.note || ''
  }
}

function columnDisplay(user: UserAccount, col: CustomerColumn) {
  switch (col) {
    case 'userName':    return user.userName
    case 'name':        return displayName(user)
    case 'idNumber':    return maskSensitive(user.idNumber)
    case 'phone':       return maskSensitive(user.phone)
    case 'moneyPaid':   return formatMoney(user.moneyPaid)
    case 'moneyUsed':   return formatMoney(user.moneyUsed)
    case 'moneyRemain': return formatMoney(user.moneyRemain)
    case 'moneyMain':   return formatMoney(user.moneyMain)
    case 'moneySub':    return formatMoney(user.moneySub)
    case 'groupName':   return user.groupName || '—'
    case 'email':       return maskSensitive(user.email)
    case 'note':        return user.note || '—'
  }
}

type UserType = 'member' | 'staff' | 'combo'

export function UsersPage() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const routeSearch = searchParams.get('search')?.trim() ?? ''

  // ── Auth ────────────────────────────────────────────────────────────────────
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const hasRight = useAuthStore((state) => state.hasRight)
  const staffName = useAuthStore((state) => state.staffName)

  // ── List state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<UserType>('member')
  const [searchTerm, setSearchTerm] = useState(routeSearch)
  const [searchQuery, setSearchQuery] = useState(routeSearch)
  // `searchField` PHẢI nằm trong queryKey: thiếu nó thì đổi trường tìm sẽ ăn cache của
  // trường trước → hiển thị kết quả sai mà không có lỗi nào báo.
  const [searchField, setSearchField] = useState<UserSearchField>('username')
  const [page, setPage] = useState(0)
  const limit = 50

  useEffect(() => {
    setActiveTab('member')
    setSearchTerm(routeSearch)
    setSearchQuery(routeSearch)
    setPage(0)
  }, [routeSearch])

  // ── Sort + Column state ─────────────────────────────────────────────────────
  const [sortColumn, setSortColumn] = useState<CustomerColumn>('userName')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [visibleColumns] = useState<CustomerColumn[]>(DEFAULT_COLUMNS)

  // ── Legacy-only feature modals ──────────────────────────────────────────────
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false)
  const [isFilePrintOpen, setIsFilePrintOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCleanModalOpen, setIsCleanModalOpen] = useState(false)
  const [cleanMonths, setCleanMonths] = useState(6)
  const [cleanIgnoreBalance, setCleanIgnoreBalance] = useState(false)
  const [cleanCandidates, setCleanCandidates] = useState<any[]>([])

  // ── Customer selection (seed pattern: sync với query sau refetch) ────────────
  const [selectedSeed, setSelectedSeed] = useState<UserAccount | null>(null)

  // ── Transaction state (aligned với CustomerWorkspace) ───────────────────────
  const [action, setAction] = useState<CustomerAction | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('cash')
  const [qrActive, setQrActive] = useState(false)
  const [note, setNote] = useState('')
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipient, setRecipient] = useState<UserAccount | null>(null)
  const [deleteRequested, setDeleteRequested] = useState(false)

  const transactionIntent = useIdempotentIntent('users-page-legacy')

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['users', activeTab, page, searchQuery, searchField],
    queryFn: () =>
      getUsers(
        activeTab,
        limit,
        page * limit,
        searchQuery || undefined,
        activeTab === 'member' ? searchField : undefined,
      ),
  })

  const users = data?.items ?? []

  // Sync selected user: nếu list refetch thì selected nhận object mới (số dư cập nhật)
  const selected = users.find((u) => u.userId === selectedSeed?.userId) ?? selectedSeed

  const recipientResults = useQuery({
    queryKey: ['users', 'member', 'transfer-recipient', recipientQuery],
    queryFn: () => getUsers('member', 12, 0, recipientQuery),
    enabled: action === 'transfer' && recipientQuery.length > 0,
  })

  const displayedColumns = useMemo(
    () => CUSTOMER_COLUMNS.filter((col) => visibleColumns.includes(col.id)),
    [visibleColumns],
  )

  const sortedUsers = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...users].sort((a, b) => {
      const av = columnValue(a, sortColumn)
      const bv = columnValue(b, sortColumn)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
      return String(av).localeCompare(String(bv), 'vi', { numeric: true, sensitivity: 'base' }) * direction
    })
  }, [users, sortColumn, sortDirection])

  const tableGridStyle = useMemo(
    () => ({ '--customer-table-columns': displayedColumns.map((c) => c.width).join(' ') }) as CSSProperties,
    [displayedColumns],
  )

  // ── Mutations ───────────────────────────────────────────────────────────────

  /** Giao dịch thống nhất: deposit / give / credit / payDebt / transfer */
  const transactionMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !action || !amount) {
        throw new Error('Giao dịch hoặc số tiền không hợp lệ')
      }
      if (action !== 'deposit' && amount <= 0) {
        throw new Error('Số tiền giao dịch phải lớn hơn 0')
      }
      const intent = {
        action,
        userId: selected.userId,
        amount,
        depositMethod: action === 'deposit' ? depositMethod : undefined,
        note: note.trim(),
        recipientId: recipient?.userId ?? 0,
      }
      const idem = transactionIntent.getKey(fingerprintIntent(intent))
      switch (action) {
        case 'deposit':
          if (!canSubmitDeposit(depositMethod, amount, hasRight(RIGHTS.INPUT_NEGATIVE_MONEY))) {
            throw new Error('Số tiền hoặc phương thức nạp không hợp lệ')
          }
          return usersApi.deposit({
            userId: selected.userId,
            chargeMoney: amount,
            paymentMethod: toDepositApiPaymentMethod(depositMethod),
            note: note.trim() || undefined,
            idem,
          })
        case 'give':
          return usersApi.giveFree({ userId: selected.userId, giveMoney: amount, idem })
        case 'credit':
          return usersApi.credit({ userId: selected.userId, borrowMoney: amount, idem })
        case 'payDebt':
          return usersApi.payDebt({ userId: selected.userId, amount, idem })
        case 'transfer':
          if (!recipient || recipient.userId === selected.userId) {
            throw new Error('Hãy chọn một hội viên nhận khác người gửi')
          }
          return usersApi.transfer({
            fromUserId: selected.userId,
            toUserId: recipient.userId,
            transferMoney: amount,
            idem,
          })
      }
    },
    onSuccess: () => {
      transactionIntent.clearKey()
      setAction(null)
      setAmount(null)
      setDepositMethod('cash')
      setQrActive(false)
      setNote('')
      setRecipient(null)
      setRecipientInput('')
      setRecipientQuery('')
      pushToast('Giao dịch đã hoàn tất và dữ liệu đang được làm mới.', 'success')
      void invalidateMoneyQueries(queryClient)
    },
    onError: (err) => pushToast(err.message, 'error'),
  })

  /** Xóa đơn lẻ — cho admin qua nút Xóa tài khoản trong CustomerInspector */
  const deleteUserMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Chưa chọn tài khoản cần xóa')
      return usersApi.deleteBatch([selected.userId])
    },
    onSuccess: () => {
      setDeleteRequested(false)
      setSelectedSeed(null)
      pushToast('Đã xóa tài khoản hội viên và giữ lại lịch sử giao dịch.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => pushToast(err.message, 'error'),
  })

  /** Dọn dẹp hàng loạt (legacy feature) */
  const loadCleanCandidatesMutation = useMutation({
    mutationFn: () => usersApi.getCleanCandidates(cleanMonths, cleanIgnoreBalance),
    onSuccess: (data: any) => {
      setCleanCandidates(Array.isArray(data) ? data : (data.data || []))
    },
    onError: (err: any) => pushToast(`Lỗi: ${err.message}`, 'error'),
  })

  const deleteBatchMutation = useMutation({
    mutationFn: () => usersApi.deleteBatch(cleanCandidates.map((c) => c.Id || c.userId)),
    onSuccess: () => {
      pushToast(`Đã xóa ${cleanCandidates.length} hội viên`, 'success')
      setIsCleanModalOpen(false)
      setCleanCandidates([])
      void queryClient.invalidateQueries({ queryKey: ['users', 'member'] })
    },
    onError: (err: any) => pushToast(`Lỗi: ${err.message}`, 'error'),
  })

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleSort = (col: CustomerColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }

  const openAction = (nextAction: CustomerAction) => {
    if (!selected) return
    if (nextAction === 'give' && !hasRight(RIGHTS.GIVE_MONEY)) {
      pushToast(`Thiếu quyền ${RIGHTS.GIVE_MONEY} để tặng tiền.`, 'info')
      return
    }
    if (nextAction === 'transfer' && !hasRight(RIGHTS.MONEY_TRANSFER)) {
      pushToast(`Thiếu quyền ${RIGHTS.MONEY_TRANSFER} để chuyển tiền.`, 'info')
      return
    }
    transactionIntent.clearKey()
    setAmount(
      nextAction === 'payDebt'
        ? debtAmount(selected) || null
        : nextAction === 'deposit'
          ? null
          : 10_000,
    )
    setDepositMethod('cash')
    setQrActive(false)
    setNote('')
    setRecipient(null)
    setRecipientInput('')
    setRecipientQuery('')
    setAction(nextAction)
  }

  const closeAction = () => {
    if (transactionMutation.isPending) return
    if (qrActive) {
      pushToast('Hãy hủy giao dịch QR đang chờ trước khi đóng cửa sổ.', 'info')
      return
    }
    transactionIntent.clearKey()
    setAction(null)
    setAmount(null)
    setDepositMethod('cash')
    setQrActive(false)
    setNote('')
    setRecipient(null)
    setRecipientInput('')
    setRecipientQuery('')
  }

  /** Tạo hội viên xong → mở luôn form nạp tiền cho đúng tài khoản đó */
  const openDepositForNewAccount = async (account: { username: string; kind: 'member' | 'staff' }) => {
    if (account.kind !== 'member') return
    try {
      const result = await getUsers('member', 5, 0, account.username)
      const created =
        result.items.find((u) => u.userName.toLowerCase() === account.username.toLowerCase()) ??
        result.items[0]
      if (!created) throw new Error('Không tìm thấy tài khoản vừa tạo')
      transactionIntent.clearKey()
      setAmount(null)
      setDepositMethod('cash')
      setQrActive(false)
      setNote('')
      setRecipient(null)
      setRecipientInput('')
      setRecipientQuery('')
      setSelectedSeed(created)
      setAction('deposit')
    } catch (err) {
      pushToast(
        `Đã tạo tài khoản nhưng chưa mở được form nạp tiền: ${(err as Error).message}`,
        'error',
      )
    }
  }

  // ── Balance preview ──────────────────────────────────────────────────────────
  const balanceBefore = selected
    ? action === 'give'
      ? selected.moneySub
      : action === 'payDebt'
        ? debtAmount(selected)
        : selected.moneyMain
    : 0
  const balanceAfter =
    action === 'payDebt'
      ? Math.max(0, balanceBefore - (amount ?? 0))
      : action === 'transfer'
        ? balanceBefore - (amount ?? 0)
        : balanceBefore + (amount ?? 0)

  return (
    <section className="customer-workspace">

      {/* ── Page Header ───────────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow="Thu ngân"
        title="Quản lý Tài khoản"
        description="Danh sách hội viên, nhân viên và thẻ combo — nạp tiền, khóa/mở thẻ, cấp lại mật khẩu."
        actions={
          <>
            {activeTab === 'member' && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<Printer size={18} weight="bold" aria-hidden="true" />}
                  onClick={() => setIsFilePrintOpen(true)}
                >
                  In từ file
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
                  onClick={() => setIsGenerateModalOpen(true)}
                >
                  Tạo hàng loạt
                </Button>
                <Button
                  type="button"
                  variant="danger-outline"
                  icon={<Broom size={18} weight="bold" aria-hidden="true" />}
                  onClick={() => setIsCleanModalOpen(true)}
                >
                  Dọn dẹp
                </Button>
              </>
            )}
            {activeTab !== 'combo' && (
              <Button
                type="button"
                variant="primary"
                icon={<UserPlus size={18} weight="bold" aria-hidden="true" />}
                onClick={() => setIsCreateOpen(true)}
              >
                Thêm {activeTab === 'member' ? 'hội viên' : 'nhân viên'}
              </Button>
            )}
          </>
        }
      />

      <div className="customer-tabs" role="tablist" aria-label="Loại tài khoản">
        {([
          ['member', 'Hội viên'],
          ['combo', 'Thẻ Combo'],
          ['staff', 'Nhân viên'],
        ] as Array<[UserType, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={activeTab === id ? 'is-active' : ''}
            onClick={() => {
              setActiveTab(id)
              setPage(0)
              setSelectedSeed(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="customer-search"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setSearchQuery(searchTerm.trim())
        }}
      >
        <label className="ds-field">
          <span className="ds-visually-hidden">
            {activeTab === 'member' ? SEARCH_FIELD_LABELS[searchField] : 'Tìm kiếm'}
          </span>
          <div className="ds-input-group ds-input-group--search">
            {activeTab === 'member' ? (
              <Select
                value={searchField}
                aria-label="Tìm theo trường"
                onChange={(event) => {
                  setSearchField(event.target.value as UserSearchField)
                  setPage(0)
                  setSelectedSeed(null)
                }}
              >
                <option value="username">Tên đăng nhập</option>
                <option value="phone">Số điện thoại</option>
                <option value="idnumber">CCCD</option>
              </Select>
            ) : null}
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                placeholder={
                  activeTab === 'member'
                    ? SEARCH_FIELD_PLACEHOLDERS[searchField]
                    : 'Nhập từ đầu tên đăng nhập...'
                }
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              {(searchTerm || searchQuery) ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa tìm kiếm"
                  onClick={() => {
                    setSearchTerm('')
                    setSearchQuery('')
                    setPage(0)
                    setSelectedSeed(null)
                  }}
                >
                  <X size={18} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </label>
      </form>

      <div className="customer-list-card">
        <ListToolbar
          count={<>Tổng <strong>{new Intl.NumberFormat('vi-VN').format(users.length)}</strong></>}
          actions={
            <>
              <RefreshButton
                loading={isLoading}
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: ['users', activeTab, page, searchQuery] })
                }
              />
              <ListPagination
                page={page}
                canNext={users.length >= limit}
                onPrevious={() => {
                  setPage((current) => Math.max(0, current - 1))
                  setSelectedSeed(null)
                }}
                onNext={() => {
                  setPage((current) => current + 1)
                  setSelectedSeed(null)
                }}
              />
            </>
          }
        />
        <div className="customer-table-scroll">
          <div className="customer-table" role="table" aria-rowcount={sortedUsers.length + 1}>
            <div
              className="customer-table__header customer-table__grid"
              role="row"
              style={tableGridStyle}
            >
              {displayedColumns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  role="columnheader"
                  className={col.money ? 'is-money' : ''}
                  aria-sort={
                    sortColumn === col.id
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  onClick={() => toggleSort(col.id)}
                >
                  <span>{col.label}</span>
                  {sortColumn === col.id ? (
                    <span className="customer-sort-mark" aria-hidden="true">
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="customer-table__empty" role="row">
                <div role="cell">Đang tải khách hàng…</div>
              </div>
            ) : isError ? (
              <div className="customer-table__empty" role="row">
                <div role="cell">
                  <p>Không tải được danh sách — {(error as Error).message}</p>
                  <Button
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ['users', activeTab, page, searchQuery] })
                    }
                  >
                    Thử lại
                  </Button>
                </div>
              </div>
            ) : sortedUsers.length === 0 ? (
              <div className="customer-table__empty" role="row">
                <div role="cell">
                  Không tìm thấy tài khoản —{' '}
                  {searchQuery
                    ? 'kiểm tra lại phần đầu tên đăng nhập, số điện thoại hoặc CCCD.'
                    : 'danh sách hiện chưa có dữ liệu.'}
                </div>
              </div>
            ) : (
              sortedUsers.map((user) => (
                <button
                  key={user.userId}
                  type="button"
                  className={`customer-table__row customer-table__grid${
                    selected?.userId === user.userId ? ' is-selected' : ''
                  }`}
                  role="row"
                  style={tableGridStyle}
                  onClick={() => setSelectedSeed(user)}
                >
                  {displayedColumns.map((col) => (
                    <div
                      key={col.id}
                      role="cell"
                      className={col.money ? 'customer-table__money' : ''}
                      title={String(columnValue(user, col.id) || '')}
                    >
                      {col.id === 'userName'
                        ? <strong>{user.userName}</strong>
                        : columnDisplay(user, col.id)}
                    </div>
                  ))}
                </button>
              ))
            )}
          </div>{/* /customer-table */}
        </div>{/* /customer-table-scroll */}
      </div>{/* /customer-list-card */}

      {/* ── Account Detail Drawer ──────────────────────────────────────────────── */}
      <Drawer
        open={Boolean(selected)}
        size="wide"
        compactHeader
        className="customer-inspector-drawer"
        title={selected?.userName ?? 'Tài khoản'}
        description={
          selected
            ? `${displayName(selected)} · ${
                selected.groupName ||
                (activeTab === 'member' ? 'Hội viên' : activeTab === 'staff' ? 'Nhân viên' : 'Thẻ Combo')
              }`
            : undefined
        }
        onClose={() => setSelectedSeed(null)}
      >
        {selected ? (
          <CustomerInspector
            user={selected}
            userType={activeTab}
            canDelete={isAdmin}
            onOpenAction={openAction}
            onRequestDelete={() => setDeleteRequested(true)}
          />
        ) : null}
      </Drawer>

      {/* ── Delete confirm ─────────────────────────────────────────────────────── */}
      <ConfirmAction
        open={deleteRequested && Boolean(selected)}
        title="Xóa tài khoản hội viên?"
        description={selected?.userName}
        confirmLabel="Xóa tài khoản"
        danger
        pending={deleteUserMutation.isPending}
        onCancel={() => setDeleteRequested(false)}
        onConfirm={() => deleteUserMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Tài khoản sẽ bị vô hiệu hóa. Máy chủ vẫn giữ lịch sử giao dịch và sẽ từ chối nếu tài
          khoản không đủ điều kiện xóa.
        </InlineAlert>
      </ConfirmAction>

      {/* ── Transaction Dialog (thống nhất, giống CustomerWorkspace) ──────────── */}
      <Dialog
        open={Boolean(action)}
        title={actionTitle(action)}
        size="sm"
        onClose={closeAction}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={transactionMutation.isPending || qrActive}
              onClick={closeAction}
            >
              Hủy
            </Button>
            {action !== 'deposit' || depositMethod !== 'qr' ? (
              <Button
                type="button"
                variant="primary"
                loading={transactionMutation.isPending}
                disabled={
                  !amount ||
                  (action !== 'deposit' && amount <= 0) ||
                  (action === 'deposit' &&
                    !canSubmitDeposit(depositMethod, amount, hasRight(RIGHTS.INPUT_NEGATIVE_MONEY))) ||
                  (action === 'transfer' && (!recipient || recipient.userId === selected?.userId))
                }
                onClick={() => transactionMutation.mutate()}
              >
                {action === 'deposit'
                  ? amount && amount < 0
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
        {selected ? (
          <div className="customer-transaction">
            <div className="customer-identity-check">
              <strong>{selected.userName}</strong>
              <small>{displayName(selected)} · {maskSensitive(selected.phone)}</small>
            </div>

            {action !== 'deposit' ? (
              <MoneyInput
                label={action === 'payDebt' ? 'Số tiền trả nợ' : 'Số tiền'}
                icon={<Coins size={18} weight="bold" aria-hidden="true" />}
                placeholder={action === 'payDebt' ? 'Số tiền trả nợ' : 'Số tiền'}
                value={amount}
                min={1_000}
                onChange={(value) => {
                  transactionIntent.clearKey()
                  setAmount(value)
                }}
              />
            ) : (
              <DepositAmountPanel
                icon={<Coins size={18} weight="bold" aria-hidden="true" />}
                placeholder="Số tiền"
                value={amount}
                disabled={transactionMutation.isPending || qrActive}
                allowNegative={hasRight(RIGHTS.INPUT_NEGATIVE_MONEY)}
                onIntentChange={transactionIntent.clearKey}
                onChange={setAmount}
              />
            )}

            {action === 'transfer' ? (
              <div className="customer-recipient-search">
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    setRecipient(null)
                    setRecipientQuery(recipientInput.trim())
                  }}
                >
                  <label className="ds-field">
                    <span className="ds-field__label">Tìm hội viên nhận</span>
                    <input
                      className="ds-input"
                      value={recipientInput}
                      placeholder="Tên đăng nhập, SĐT hoặc CCCD"
                      onChange={(event) => setRecipientInput(event.target.value)}
                    />
                  </label>
                  <Button type="submit" variant="secondary">Tìm</Button>
                </form>
                {recipientQuery ? (
                  <div className="customer-recipient-results">
                    {(recipientResults.data?.items ?? [])
                      .filter((u) => u.userId !== selected.userId)
                      .map((u) => (
                        <button
                          key={u.userId}
                          type="button"
                          className={recipient?.userId === u.userId ? 'is-selected' : ''}
                          onClick={() => {
                            transactionIntent.clearKey()
                            setRecipient(u)
                          }}
                        >
                          <strong>{u.userName}</strong>
                          <span>{displayName(u)} · {maskSensitive(u.phone)}</span>
                        </button>
                      ))}
                    {!recipientResults.isLoading &&
                    (recipientResults.data?.items ?? []).filter(
                      (u) => u.userId !== selected.userId,
                    ).length === 0 ? (
                      <InlineAlert tone="warning">Không tìm thấy hội viên nhận phù hợp.</InlineAlert>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {action === 'deposit' ? (
              <>
                <DepositMethodSelector
                  value={depositMethod}
                  disabled={transactionMutation.isPending || qrActive}
                  onChange={(method) => {
                    transactionIntent.clearKey()
                    setDepositMethod(method)
                  }}
                />
                {depositMethod !== 'qr' ? (
                  <div className="ds-input-group customer-create-form__group">
                    <label
                      className="ds-input-group-separator customer-create-form__label"
                      htmlFor="legacy-deposit-note"
                      title="Ghi chú"
                    >
                      <NotePencil size={18} weight="bold" aria-hidden="true" />
                      <span className="ds-visually-hidden">Ghi chú (không bắt buộc)</span>
                    </label>
                    <input
                      id="legacy-deposit-note"
                      className="ds-input"
                      placeholder="Ghi chú (không bắt buộc)"
                      value={note}
                      maxLength={100}
                      onChange={(event) => {
                        transactionIntent.clearKey()
                        setNote(event.target.value)
                      }}
                    />
                  </div>
                ) : null}
                {depositMethod === 'cash' ? (
                  amount && amount < 0 ? (
                    <InlineAlert tone="info">
                      Số tiền âm là thao tác rút; máy chủ vẫn kiểm tra quyền và số dư khả dụng.
                    </InlineAlert>
                  ) : null
                ) : depositMethod === 'qr' ? (
                  <DepositQrFlow
                    userId={selected.userId}
                    amount={amount}
                    disabled={transactionMutation.isPending}
                    onActiveChange={setQrActive}
                  />
                ) : amount && amount < 0 ? (
                  <InlineAlert tone="info">
                    Số tiền âm ghi nhận khoản rút/hoàn qua chuyển khoản; máy chủ vẫn kiểm tra quyền và số dư.
                  </InlineAlert>
                ) : null}
              </>
            ) : null}

            <dl className="customer-transaction-summary">
              {action === 'deposit' ? (
                <div>
                  <dt>Phương thức</dt>
                  <dd>{getDepositMethodOption(depositMethod).label}</dd>
                </div>
              ) : null}
              <div>
                <dt>{action === 'payDebt' ? 'Dư nợ trước' : 'Số dư nguồn trước'}</dt>
                <dd>{formatMoney(balanceBefore)}</dd>
              </div>
              <div>
                <dt>{action === 'payDebt' ? 'Dư nợ dự kiến sau' : 'Số dư nguồn dự kiến sau'}</dt>
                <dd>{formatMoney(balanceAfter)}</dd>
              </div>
              {action === 'transfer' ? (
                <div><dt>Hội viên nhận</dt><dd>{recipient?.userName || 'Chưa chọn'}</dd></div>
              ) : null}
              <div><dt>Người thao tác</dt><dd>{staffName || '—'}</dd></div>
            </dl>
          </div>
        ) : null}
      </Dialog>

      {/* ── Legacy-specific dialogs ────────────────────────────────────────────── */}
      <AutoGenerateMemberDialog
        open={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
      />
      {activeTab !== 'combo' && (
        <CreateUserDialog
          open={isCreateOpen}
          kind={activeTab}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(account) => void openDepositForNewAccount(account)}
        />
      )}
      <CredentialFilePrintDialog
        open={isFilePrintOpen}
        kind="member"
        onClose={() => setIsFilePrintOpen(false)}
      />

      {/* Modal Dọn Dẹp */}
      {isCleanModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            className="page-card"
            style={{ width: '600px', backgroundColor: 'var(--surface)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
              Dọn dẹp hội viên cũ
            </h3>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Không hoạt động trong (tháng)</span>
                <input
                  type="number"
                  value={cleanMonths}
                  onChange={(e) => setCleanMonths(Number(e.target.value))}
                  min={1}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem', flex: 1 }}>
                <input
                  type="checkbox"
                  checked={cleanIgnoreBalance}
                  onChange={(e) => setCleanIgnoreBalance(e.target.checked)}
                />
                <span style={{ fontSize: '0.85em' }}>Bỏ qua tài khoản còn số dư</span>
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => loadCleanCandidatesMutation.mutate()}
                disabled={loadCleanCandidatesMutation.isPending}
              >
                Lọc danh sách
              </button>
            </div>

            {cleanCandidates.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ color: 'var(--text-error)', marginBottom: '0.5rem', fontWeight: 500 }}>
                  Tìm thấy {cleanCandidates.length} hội viên có thể xóa.
                </div>
                <div
                  style={{
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                  }}
                >
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr><th>Username</th><th>Lần cuối HĐ</th></tr>
                    </thead>
                    <tbody>
                      {cleanCandidates.map((c, idx) => (
                        <tr key={idx}>
                          <td>{c.Name || c.userName}</td>
                          <td>{c.LastActive || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setIsCleanModalOpen(false)
                  setCleanCandidates([])
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="primary-button"
                style={{ backgroundColor: 'var(--text-error)' }}
                onClick={() => deleteBatchMutation.mutate()}
                disabled={cleanCandidates.length === 0 || deleteBatchMutation.isPending}
              >
                {deleteBatchMutation.isPending ? 'Đang xóa...' : 'Xóa hàng loạt'}
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  )
}
