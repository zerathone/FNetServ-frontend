import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { getUsers, usersApi, type UserAccount, type UserSearchField } from '../../api/users'
import {
  Button,
  ConfirmAction,
  Dialog,
  Drawer,
  InlineAlert,
  ListPagination,
  MoneyInput,
  PageHeader,
  Select,
  StateView,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { getBrowserPreferences, updateBrowserPreferences } from '../../preferences/preferenceStore'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { DepositMethodSelector } from '../payments/DepositMethodSelector'
import { DepositAmountPanel } from '../payments/DepositAmountPanel'
import { DepositQrFlow } from '../payments/DepositQrFlow'
import { CredentialFilePrintDialog } from '../printers/CredentialFilePrintDialog'
import {
  canSubmitDeposit,
  getDepositMethodOption,
  toDepositApiPaymentMethod,
  type DepositMethod,
} from '../payments/depositModel'
import { AutoGenerateMemberDialog } from './AutoGenerateMemberDialog'
import { CustomerInspector } from './CustomerInspector'
import './customers.css'

const PAGE_SIZE = 50
const RIGHTS = {
  GIVE_MONEY: 11,
  MONEY_TRANSFER: 25,
  INPUT_NEGATIVE_MONEY: 26,
} as const

type UserType = 'member' | 'staff' | 'combo'

// FIXBUG 2026-09-23: nhan cho tung truong tim. Chi ap dung cho tab "Hoi vien" --
// tab staff/combo BE loc in-memory theo ten da giai ma, khong nhan tham so `qby`.
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
type CustomerAction = 'deposit' | 'give' | 'credit' | 'payDebt' | 'transfer'
type CustomerColumn =
  | 'userName'
  | 'name'
  | 'idNumber'
  | 'phone'
  | 'moneyPaid'
  | 'moneyUsed'
  | 'moneyRemain'
  | 'moneyMain'
  | 'moneySub'
  | 'groupName'
  | 'email'
  | 'note'

const CUSTOMER_COLUMNS: Array<{
  id: CustomerColumn
  label: string
  required?: boolean
  width: string
  money?: boolean
}> = [
  { id: 'userName', label: 'Tên đăng nhập', required: true, width: 'minmax(10rem, 1.15fr)' },
  { id: 'name', label: 'Tên', required: true, width: 'minmax(10rem, 1.2fr)' },
  { id: 'idNumber', label: 'Số CCCD', width: '8.5rem' },
  { id: 'phone', label: 'Điện thoại', width: '8.5rem' },
  { id: 'moneyPaid', label: 'Số tiền nạp', width: '8rem', money: true },
  { id: 'moneyUsed', label: 'Số tiền đã dùng', width: '8rem', money: true },
  { id: 'moneyRemain', label: 'Số tiền còn lại', width: '8.5rem', money: true },
  { id: 'moneyMain', label: 'Tài khoản chính', width: '8.5rem', money: true },
  { id: 'moneySub', label: 'Khuyến mãi', width: '8rem', money: true },
  { id: 'groupName', label: 'Nhóm người dùng', width: 'minmax(8rem, 1fr)' },
  { id: 'email', label: 'Email', width: 'minmax(12rem, 1.35fr)' },
  { id: 'note', label: 'Ghi chú', width: 'minmax(11rem, 1.25fr)' },
]

const DEFAULT_CUSTOMER_COLUMNS: CustomerColumn[] = [
  'userName',
  'name',
  'idNumber',
  'phone',
  'moneyRemain',
  'moneyMain',
  'moneySub',
  'groupName',
  'email',
  'note',
]

function readCustomerColumns(): CustomerColumn[] {
  const valid = new Set(CUSTOMER_COLUMNS.map((column) => column.id))
  const saved = getBrowserPreferences().customerColumns ?? []
  const optional = saved.filter((id): id is CustomerColumn => valid.has(id as CustomerColumn))
  return Array.from(
    new Set<CustomerColumn>([
      'userName',
      'name',
      ...(optional.length ? optional : DEFAULT_CUSTOMER_COLUMNS),
    ]),
  )
}

function customerColumnValue(user: UserAccount, column: CustomerColumn): string | number {
  switch (column) {
    case 'userName': return user.userName
    case 'name': return displayName(user)
    case 'idNumber': return user.idNumber || ''
    case 'phone': return user.phone || ''
    case 'moneyPaid': return user.moneyPaid
    case 'moneyUsed': return user.moneyUsed
    case 'moneyRemain': return user.moneyRemain
    case 'moneyMain': return user.moneyMain
    case 'moneySub': return user.moneySub
    case 'groupName': return user.groupName || ''
    case 'email': return user.email || ''
    case 'note': return user.note || ''
  }
}

function customerColumnDisplay(user: UserAccount, column: CustomerColumn) {
  switch (column) {
    case 'userName': return user.userName
    case 'name': return displayName(user)
    case 'idNumber': return maskSensitive(user.idNumber)
    case 'phone': return maskSensitive(user.phone)
    case 'moneyPaid': return formatMoney(user.moneyPaid)
    case 'moneyUsed': return formatMoney(user.moneyUsed)
    case 'moneyRemain': return formatMoney(user.moneyRemain)
    case 'moneyMain': return formatMoney(user.moneyMain)
    case 'moneySub': return formatMoney(user.moneySub)
    case 'groupName': return user.groupName || '—'
    case 'email': return maskSensitive(user.email)
    case 'note': return user.note || '—'
  }
}

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
    case 'deposit':
      return 'Nạp tiền hội viên'
    case 'give':
      return 'Tặng tiền hội viên'
    case 'credit':
      return 'Cho mượn tiền'
    case 'payDebt':
      return 'Thanh toán nợ'
    case 'transfer':
      return 'Chuyển tiền hội viên'
    default:
      return 'Giao dịch hội viên'
  }
}

export function CustomerWorkspace() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const routeSearch = searchParams.get('search')?.trim() ?? ''
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const staffName = useAuthStore((state) => state.staffName)
  const hasRight = useAuthStore((state) => state.hasRight)
  const [userType, setUserType] = useState<UserType>('member')
  const [searchInput, setSearchInput] = useState(routeSearch)
  const [searchQuery, setSearchQuery] = useState(routeSearch)
  // FIXBUG 2026-09-23: tim theo DUNG 1 truong. Gop 3 truong = 3 luot quet bang hoi vien o BE.
  const [searchField, setSearchField] = useState<UserSearchField>('username')
  const [page, setPage] = useState(0)
  const [selectedSeed, setSelectedSeed] = useState<UserAccount | null>(null)
  const [action, setAction] = useState<CustomerAction | null>(null)
  const [amount, setAmount] = useState<number | null>(10_000)
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('cash')
  const [qrActive, setQrActive] = useState(false)
  const [note, setNote] = useState('')
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipient, setRecipient] = useState<UserAccount | null>(null)
  const [deleteRequested, setDeleteRequested] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<CustomerColumn[]>(readCustomerColumns)
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const [sortColumn, setSortColumn] = useState<CustomerColumn>('userName')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [generateMembersOpen, setGenerateMembersOpen] = useState(false)
  const [filePrintOpen, setFilePrintOpen] = useState(false)
  const transactionIntent = useIdempotentIntent('customer-workspace')

  useEffect(() => {
    setUserType('member')
    setSearchInput(routeSearch)
    setSearchQuery(routeSearch)
    setPage(0)
  }, [routeSearch])

  const usersQuery = useQuery({
    // `searchField` PHAI nam trong queryKey: thieu no thi doi truong tim se an cache cua
    // truong truoc -> hien ket qua sai ma khong co loi nao bao.
    queryKey: ['users', userType, page, searchQuery, searchField],
    queryFn: () =>
      getUsers(
        userType,
        PAGE_SIZE,
        page * PAGE_SIZE,
        searchQuery || undefined,
        userType === 'member' ? searchField : undefined,
      ),
  })
  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data])
  const displayedColumns = useMemo(
    () => CUSTOMER_COLUMNS.filter((column) => visibleColumns.includes(column.id)),
    [visibleColumns],
  )
  const sortedUsers = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1
    return [...users].sort((left, right) => {
      const leftValue = customerColumnValue(left, sortColumn)
      const rightValue = customerColumnValue(right, sortColumn)
      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction
      }
      return String(leftValue).localeCompare(String(rightValue), 'vi', {
        numeric: true,
        sensitivity: 'base',
      }) * direction
    })
  }, [sortColumn, sortDirection, users])
  const tableGridStyle = useMemo(
    () => ({
      '--customer-table-columns': displayedColumns.map((column) => column.width).join(' '),
    }) as CSSProperties,
    [displayedColumns],
  )
  const selected =
    users.find((user) => user.userId === selectedSeed?.userId) ?? selectedSeed

  useEffect(() => {
    updateBrowserPreferences({ customerColumns: visibleColumns })
  }, [visibleColumns])

  useEffect(() => {
    if (!columnMenuOpen) return
    const closeMenu = () => setColumnMenuOpen(false)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [columnMenuOpen])

  const toggleColumn = (column: CustomerColumn) => {
    const definition = CUSTOMER_COLUMNS.find((item) => item.id === column)
    if (definition?.required) return
    setVisibleColumns((current) =>
      current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column],
    )
  }

  const toggleSort = (column: CustomerColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortColumn(column)
    setSortDirection('asc')
  }

  const recipientResults = useQuery({
    queryKey: ['users', 'member', 'transfer-recipient', recipientQuery],
    queryFn: () => getUsers('member', 12, 0, recipientQuery),
    enabled: action === 'transfer' && recipientQuery.length > 0,
  })

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
          if (
            !canSubmitDeposit(
              depositMethod,
              amount,
              hasRight(RIGHTS.INPUT_NEGATIVE_MONEY),
            )
          ) {
            throw new Error(
              'Số tiền hoặc phương thức nạp không hợp lệ',
            )
          }
          return usersApi.deposit({
            userId: selected.userId,
            chargeMoney: amount,
            paymentMethod: toDepositApiPaymentMethod(depositMethod),
            note: note.trim() || undefined,
            idem,
          })
        case 'give':
          return usersApi.giveFree({
            userId: selected.userId,
            giveMoney: amount,
            idem,
          })
        case 'credit':
          return usersApi.credit({
            userId: selected.userId,
            borrowMoney: amount,
            idem,
          })
        case 'payDebt':
          return usersApi.payDebt({
            userId: selected.userId,
            amount,
            idem,
          })
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
    onError: (error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
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
    onError: (error) => pushToast(error.message, 'error'),
  })

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const normalized = searchInput.trim()
    setPage(0)
    setSearchQuery(normalized)
    setSelectedSeed(null)
    setSearchParams(normalized ? { search: normalized } : {})
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
      <PageHeader
        eyebrow="Thu ngân"
        title="Tài khoản"
        description={
          userType === 'member'
            ? `Tìm theo đầu ${SEARCH_FIELD_LABELS[searchField].toLowerCase()}; xác minh đúng người trước giao dịch.`
            : 'Tìm theo đầu tên đăng nhập; xác minh đúng người trước giao dịch.'
        }
        actions={
          isAdmin ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setFilePrintOpen(true)}>
                In tài khoản từ file
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/users/legacy')}>
                Quản trị tài khoản nâng cao
              </Button>
              <Button type="button" variant="primary" onClick={() => setGenerateMembersOpen(true)}>
                Tạo hội viên hàng loạt
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="customer-tabs" role="tablist" aria-label="Loại tài khoản">
        {([
          ['member', 'Hội viên'],
          ['combo', 'Thẻ combo'],
          ['staff', 'Nhân viên'],
        ] as Array<[UserType, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={userType === id}
            className={userType === id ? 'is-active' : ''}
            onClick={() => {
              setUserType(id)
              setPage(0)
              setSelectedSeed(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="customer-search" onSubmit={submitSearch}>
        <label className="ds-field">
          <span className="ds-visually-hidden">{SEARCH_FIELD_LABELS[searchField]}</span>
          <div className="ds-input-group ds-input-group--search">
            {userType === 'member' ? (
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
                <option value="phone">Điện thoại</option>
                <option value="idnumber">CCCD</option>
              </Select>
            ) : null}
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={searchInput}
                placeholder={
                  userType === 'member'
                    ? SEARCH_FIELD_PLACEHOLDERS[searchField]
                    : 'Nhập từ đầu tên đăng nhập...'
                }
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput || searchQuery ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa tìm kiếm"
                  onClick={() => {
                    setSearchInput('')
                    setSearchQuery('')
                    setPage(0)
                    setSelectedSeed(null)
                    setSearchParams({})
                  }}
                >
                  <XCircle size={18} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </label>
      </form>


      <div className="customer-list-card">
        {usersQuery.isLoading ? (
          <StateView title="Đang tải khách hàng" />
        ) : usersQuery.isError ? (
          <StateView
            title="Không tải được danh sách"
            description={(usersQuery.error as Error).message}
            action={<Button onClick={() => usersQuery.refetch()}>Thử lại</Button>}
          />
        ) : users.length === 0 ? (
          <StateView
            title="Không tìm thấy tài khoản"
            description={
              searchQuery
                ? 'Kiểm tra lại phần đầu tên đăng nhập, số điện thoại hoặc CCCD.'
                : 'Danh sách hiện chưa có dữ liệu.'
            }
          />
        ) : (
          <>
            <div className="customer-table-tools">
              <span>{users.length} tài khoản trên trang này</span>
              <div className="customer-table-tools__actions">
              <ListPagination
                page={page}
                canNext={users.length >= PAGE_SIZE}
                onPrevious={() => {
                  setPage((current) => Math.max(0, current - 1))
                  setSelectedSeed(null)
                }}
                onNext={() => {
                  setPage((current) => current + 1)
                  setSelectedSeed(null)
                }}
              />
              <div className="customer-column-picker">
                <Button
                  type="button"
                  variant="ghost"
                  aria-haspopup="menu"
                  aria-expanded={columnMenuOpen}
                  onClick={(event) => {
                    event.stopPropagation()
                    setColumnMenuOpen((open) => !open)
                  }}
                >
                  <span aria-hidden="true">☷</span>
                  Cột hiển thị
                </Button>
                {columnMenuOpen ? (
                  <div
                    className="customer-column-menu"
                    role="menu"
                    aria-label="Chọn cột hiển thị"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div>
                      <strong>Cột hiển thị</strong>
                      <span>Nhấp phải tiêu đề để mở nhanh</span>
                    </div>
                    {CUSTOMER_COLUMNS.map((column) => (
                      <label key={column.id} className={column.required ? 'is-required' : ''}>
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(column.id)}
                          disabled={column.required}
                          onChange={() => toggleColumn(column.id)}
                        />
                        <span>{column.label}</span>
                        {column.required ? <small>Bắt buộc</small> : null}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              </div>
            </div>
            <div className="customer-table-scroll">
              <div className="customer-table" role="table" aria-rowcount={sortedUsers.length + 1}>
                <div
                  className="customer-table__header customer-table__grid"
                  role="row"
                  style={tableGridStyle}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setColumnMenuOpen(true)
                  }}
                >
                  {displayedColumns.map((column) => (
                    <button
                      key={column.id}
                      type="button"
                      role="columnheader"
                      className={column.money ? 'is-money' : ''}
                      aria-sort={sortColumn === column.id ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      onClick={() => toggleSort(column.id)}
                    >
                      <span>{column.label}</span>
                      {sortColumn === column.id ? (
                        <span className="customer-sort-mark" aria-hidden="true">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {sortedUsers.map((user) => (
                  <button
                    key={user.userId}
                    type="button"
                    className={`customer-table__row customer-table__grid${selected?.userId === user.userId ? ' is-selected' : ''}`}
                    role="row"
                    style={tableGridStyle}
                    onClick={() => setSelectedSeed(user)}
                  >
                    {displayedColumns.map((column) => (
                      <div
                        key={column.id}
                        role="cell"
                        className={column.money ? 'customer-table__money' : ''}
                        title={String(customerColumnValue(user, column.id) || '')}
                      >
                        {column.id === 'userName' ? (
                          <strong>{user.userName}</strong>
                        ) : customerColumnDisplay(user, column.id)}
                      </div>
                    ))}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <AutoGenerateMemberDialog
        open={generateMembersOpen}
        onClose={() => setGenerateMembersOpen(false)}
      />
      <CredentialFilePrintDialog
        open={filePrintOpen}
        kind="member"
        onClose={() => setFilePrintOpen(false)}
      />

      <Drawer
        open={Boolean(selected)}
        size="wide"
        compactHeader
        className="customer-inspector-drawer"
        title={selected?.userName ?? 'Khách hàng'}
        description={selected ? `${displayName(selected)} · ${selected.groupName || 'Chưa có nhóm'}` : undefined}
        onClose={() => setSelectedSeed(null)}
      >
        {selected ? (
          <CustomerInspector
            user={selected}
            userType={userType}
            canDelete={isAdmin}
            onOpenAction={openAction}
            onRequestDelete={() => setDeleteRequested(true)}
          />
        ) : null}
      </Drawer>

      <ConfirmAction
        open={deleteRequested && Boolean(selected)}
        title="Xóa tài khoản hội viên?"
        description={selected?.userName}
        confirmLabel="Xóa tài khoản"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setDeleteRequested(false)}
        onConfirm={() => deleteMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Tài khoản sẽ bị vô hiệu hóa. Máy chủ vẫn giữ lịch sử giao dịch và sẽ từ chối nếu tài khoản không đủ điều kiện xóa.
        </InlineAlert>
      </ConfirmAction>

      <Dialog
        open={Boolean(action)}
        title={actionTitle(action)}
        description={selected?.userName}
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
                    !canSubmitDeposit(
                      depositMethod,
                      amount,
                      hasRight(RIGHTS.INPUT_NEGATIVE_MONEY),
                    )) ||
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
              <span>Đúng người nhận/gửi?</span>
              <strong>{selected.userName}</strong>
              <small>{displayName(selected)} · {maskSensitive(selected.phone)}</small>
            </div>
            {action !== 'deposit' ? (
              <MoneyInput
                label={action === 'payDebt' ? 'Số tiền trả nợ' : 'Số tiền'}
                value={amount}
                min={1_000}
                onChange={(value) => {
                  transactionIntent.clearKey()
                  setAmount(value)
                }}
              />
            ) : (
              <DepositAmountPanel
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
                      .filter((user) => user.userId !== selected.userId)
                      .map((user) => (
                        <button
                          key={user.userId}
                          type="button"
                          className={recipient?.userId === user.userId ? 'is-selected' : ''}
                          onClick={() => {
                            transactionIntent.clearKey()
                            setRecipient(user)
                          }}
                        >
                          <strong>{user.userName}</strong>
                          <span>{displayName(user)} · {maskSensitive(user.phone)}</span>
                        </button>
                      ))}
                    {!recipientResults.isLoading &&
                    (recipientResults.data?.items ?? []).filter(
                      (user) => user.userId !== selected.userId,
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
                  <label className="ds-field">
                    <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
                    <input
                      className="ds-input"
                      value={note}
                      maxLength={100}
                      onChange={(event) => {
                        transactionIntent.clearKey()
                        setNote(event.target.value)
                      }}
                    />
                  </label>
                ) : null}
                {depositMethod === 'cash' ? (
                  <InlineAlert tone="info">
                    {amount && amount < 0
                      ? 'Số tiền âm là thao tác rút; máy chủ vẫn kiểm tra quyền và số dư khả dụng.'
                      : 'Tiền mặt dùng contract hiện tại và được ghi nhận ngay sau khi xác nhận.'}
                  </InlineAlert>
                ) : depositMethod === 'qr' ? (
                  <DepositQrFlow
                    userId={selected.userId}
                    amount={amount}
                    disabled={transactionMutation.isPending}
                    onActiveChange={setQrActive}
                  />
                ) : (
                  <InlineAlert tone="info">
                    {amount && amount < 0
                      ? 'Số tiền âm ghi nhận khoản rút/hoàn qua chuyển khoản; máy chủ vẫn kiểm tra quyền và số dư.'
                      : 'Chỉ xác nhận sau khi đã đối soát khoản chuyển. Giao dịch được ghi đúng loại Chuyển khoản trên máy chủ.'}
                  </InlineAlert>
                )}
              </>
            ) : null}
            <dl className="customer-transaction-summary">
              {action === 'deposit' ? (
                <div>
                  <dt>Phương thức</dt>
                  <dd>{getDepositMethodOption(depositMethod).label}</dd>
                </div>
              ) : null}
              <div><dt>{action === 'payDebt' ? 'Dư nợ trước' : 'Số dư nguồn trước'}</dt><dd>{formatMoney(balanceBefore)}</dd></div>
              <div><dt>{action === 'payDebt' ? 'Dư nợ dự kiến sau' : 'Số dư nguồn dự kiến sau'}</dt><dd>{formatMoney(balanceAfter)}</dd></div>
              {action === 'transfer' ? <div><dt>Hội viên nhận</dt><dd>{recipient?.userName || 'Chưa chọn'}</dd></div> : null}
              <div><dt>Người thao tác</dt><dd>{staffName || '—'}</dd></div>
            </dl>
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}
