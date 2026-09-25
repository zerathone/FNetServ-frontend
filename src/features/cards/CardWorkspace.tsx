import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi, type CardDateField } from '../../api/cards'
import {
  Button,
  ConfirmAction,
  DateRangePicker,
  FilterHeaderCell,
  InlineAlert,
  ListPagination,
  PageHeader,
  RefreshButton,
  Select,
  StateView,
  StatusBadge,
  type FilterMenuOption,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { CredentialFilePrintDialog } from '../printers/CredentialFilePrintDialog'
import { BatchCreateVoucherDialog } from './BatchCreateVoucherDialog'
import {
  canLockCard,
  canServerDeleteCard,
  cardStatusMeta,
  isCardExpired,
} from './cardModel'
import './cards.css'

const PAGE_SIZE = 50

// Mã lọc của GET /cards: 1/2 = cột Status; 4/3 = Status=0 tách theo hạn dùng (server tính).
const CARD_FILTER = { all: -1, used: 1, locked: 2, expired: 3, unused: 4 } as const

const STATUS_FILTER_OPTIONS: FilterMenuOption<number>[] = [
  { value: CARD_FILTER.unused, label: 'Chưa dùng', color: 'var(--color-success)' },
  { value: CARD_FILTER.used, label: 'Đã dùng' },
  { value: CARD_FILTER.locked, label: 'Đã khóa', color: 'var(--color-danger)' },
  { value: CARD_FILTER.expired, label: 'Hết hạn', color: 'var(--color-warning)' },
  { value: CARD_FILTER.all, label: 'Tất cả' },
]

type Confirmation = 'lock' | 'delete' | null

type DateFilterField = 'all' | CardDateField

const DATE_FIELD_OPTIONS: Array<{ value: DateFilterField; label: string }> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'createDate', label: 'Tạo thẻ' },
  { value: 'modifyDate', label: 'Nạp thẻ' },
  { value: 'expiryDate', label: 'Hết hạn' },
]

function localDateAfter(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function CardWorkspace() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const [status, setStatus] = useState(-1)
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [filePrintOpen, setFilePrintOpen] = useState(false)
  const today = localDateAfter(0)
  const [dateField, setDateField] = useState<DateFilterField>('all')
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const dateRangeActive = dateField !== 'all'
  const dateRangeValid = !dateRangeActive || !fromDate || !toDate || fromDate <= toDate

  const dateFilter =
    dateRangeActive && fromDate && toDate
      ? { dateField: dateField as CardDateField, from: fromDate, to: toDate }
      : {}
  const dateFilterKey = [
    dateRangeActive ? dateField : null,
    dateRangeActive ? fromDate : null,
    dateRangeActive ? toDate : null,
  ]

  const cardsQuery = useQuery({
    queryKey: ['cards', status, page, ...dateFilterKey],
    queryFn: () =>
      cardsApi.getList({
        status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...dateFilter,
      }),
    enabled: dateRangeValid,
  })

  // Đếm trên cùng bộ lọc ngày với danh sách (parity CardManagementDlg::RefreshCurrentData).
  const statusCountsQuery = useQuery({
    queryKey: ['cards', 'status-counts', ...dateFilterKey],
    queryFn: async () => {
      const [unused, used, locked, expired] = await Promise.all([
        cardsApi.getList({ status: CARD_FILTER.unused, limit: 1, ...dateFilter }),
        cardsApi.getList({ status: CARD_FILTER.used, limit: 1, ...dateFilter }),
        cardsApi.getList({ status: CARD_FILTER.locked, limit: 1, ...dateFilter }),
        cardsApi.getList({ status: CARD_FILTER.expired, limit: 1, ...dateFilter }),
      ])
      return {
        unused: unused.total,
        used: used.total,
        locked: locked.total,
        expired: expired.total,
      }
    },
    enabled: dateRangeValid,
  })
  const statusCounts = statusCountsQuery.data ?? { unused: 0, used: 0, locked: 0, expired: 0 }
  const statTiles = [
    { value: CARD_FILTER.unused, label: 'Chưa dùng', dot: 'unused', count: statusCounts.unused },
    { value: CARD_FILTER.used, label: 'Đã dùng', dot: 'used', count: statusCounts.used },
    { value: CARD_FILTER.locked, label: 'Đã khóa', dot: 'locked', count: statusCounts.locked },
    { value: CARD_FILTER.expired, label: 'Hết hạn', dot: 'expired', count: statusCounts.expired },
  ]

  const cards = cardsQuery.data?.items ?? []
  const total = cardsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selectedCards = cards.filter((card) => selectedIds.has(card.cardId))
  const lockableIds = selectedCards.filter(canLockCard).map((card) => card.cardId)
  const deletableCount = selectedCards.filter((card) =>
    canServerDeleteCard(card, today),
  ).length

  const refreshCards = () =>
    queryClient.invalidateQueries({ queryKey: ['cards'] })

  const lockMutation = useMutation({
    mutationFn: () => cardsApi.lockCards(lockableIds),
    onSuccess: (response) => {
      setConfirmation(null)
      setSelectedIds(new Set())
      pushToast(
        `Đã khóa ${response.lockedCount} thẻ${
          response.failed.length ? ` · ${response.failed.length} thẻ không còn hợp lệ` : ''
        }.`,
        response.failed.length ? 'info' : 'success',
      )
      void refreshCards()
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => cardsApi.deleteCards([...selectedIds], true),
    onSuccess: (response) => {
      setConfirmation(null)
      setSelectedIds(new Set())
      const deleted = response.deletedCount ?? 0
      const failed = response.failed?.length ?? 0
      pushToast(
        `Đã xóa ${deleted} thẻ${failed ? ` · ${failed} thẻ còn giá trị được giữ lại` : ''}.`,
        failed ? 'info' : 'success',
      )
      void refreshCards()
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const changeStatus = (nextStatus: number) => {
    setStatus(nextStatus)
    setPage(0)
    setSelectedIds(new Set())
  }

  const changeDateField = (nextField: DateFilterField) => {
    setDateField(nextField)
    if (nextField !== 'all') {
      setFromDate(today)
      setToDate(today)
    }
    setPage(0)
    setSelectedIds(new Set())
  }

  const hasActiveFilter = status !== -1 || dateRangeActive
  const clearFilters = () => {
    changeStatus(-1)
    changeDateField('all')
  }

  const toggleCard = (cardId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  const allVisibleSelected =
    cards.length > 0 && cards.every((card) => selectedIds.has(card.cardId))

  const toggleVisible = () => {
    setSelectedIds(
      allVisibleSelected ? new Set() : new Set(cards.map((card) => card.cardId)),
    )
  }

  return (
    <section className="card-workspace">
      <PageHeader
        eyebrow="Quản trị"
        title="Thẻ nạp"
        description="Quản lý vòng đời thẻ và tạo mã mới. Mã bí mật chỉ được trả một lần sau khi tạo."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => navigate('/card-sale')}>
              Bán thẻ nạp
            </Button>
            {isAdmin ? (
              <>
                <Button type="button" variant="secondary" onClick={() => setFilePrintOpen(true)}>
                  In từ file Text
                </Button>
                <Button type="button" variant="primary" onClick={() => setGenerateOpen(true)}>
                  Tạo thẻ hàng loạt
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <section className="card-date-filter" aria-label="Lọc theo ngày">
        <div className="ds-input-group">
          <span className="ds-input-group-separator">Ngày</span>
          <Select
            className="ds-select"
            value={dateField}
            onChange={(event) => changeDateField(event.target.value as DateFilterField)}
          >
            {DATE_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div
          className={`card-date-filter__range${dateRangeActive ? '' : ' is-disabled'}`}
          aria-disabled={!dateRangeActive}
        >
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onFromDateChange={(value) => {
              setFromDate(value)
              setPage(0)
            }}
            onToDateChange={(value) => {
              setToDate(value)
              setPage(0)
            }}
          />
        </div>
      </section>

      {dateRangeActive && !dateRangeValid ? (
        <InlineAlert tone="danger">Ngày bắt đầu không được sau ngày kết thúc.</InlineAlert>
      ) : null}

      {selectedIds.size > 0 ? (
        <section className="card-selection" aria-label="Thao tác thẻ đã chọn">
          <div>
            <strong>{selectedIds.size} thẻ đã chọn</strong>
            <span>
              {lockableIds.length} có thể khóa · {deletableCount} có thể xóa theo
              guard máy chủ
            </span>
          </div>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={lockableIds.length === 0}
              onClick={() => setConfirmation('lock')}
            >
              Khóa thẻ chưa dùng
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmation('delete')}
            >
              Xóa có điều kiện
            </Button>
          </div>
        </section>
      ) : null}

      <section className="card-panel" aria-label="Danh sách thẻ nạp">
        <div className="card-panel__header">
          <div className="card-panel__summary">
            <button
              type="button"
              className={`card-stat ${status === -1 ? 'is-active' : ''}`}
              onClick={() => changeStatus(-1)}
            >
              <strong>{new Intl.NumberFormat('vi-VN').format(total)} thẻ</strong>
            </button>
            <div className="card-stat-row">
              {statTiles.map((tile) => (
                <button
                  key={tile.value}
                  type="button"
                  className={`card-stat ${status === tile.value ? 'is-active' : ''}`}
                  onClick={() => changeStatus(status === tile.value ? CARD_FILTER.all : tile.value)}
                >
                  <span className={`card-stat__dot card-stat__dot--${tile.dot}`} aria-hidden="true" />
                  <span className="card-stat__label">{tile.label}</span>
                  <strong>{new Intl.NumberFormat('vi-VN').format(tile.count)}</strong>
                </button>
              ))}
            </div>
          </div>
          <div className="card-panel__toolbar">
            <RefreshButton
              loading={cardsQuery.isFetching}
              onClick={() => void cardsQuery.refetch()}
            />
            <ListPagination
              page={page}
              totalPages={totalPages}
              canNext={page < totalPages - 1}
              onPrevious={() => {
                setPage((value) => Math.max(0, value - 1))
                setSelectedIds(new Set())
              }}
              onNext={() => {
                setPage((value) => value + 1)
                setSelectedIds(new Set())
              }}
            />
          </div>
        </div>

        {cardsQuery.isLoading ? (
          <StateView title="Đang tải danh sách thẻ…" />
        ) : cardsQuery.isError ? (
          <StateView
            title="Không tải được danh sách thẻ"
            description={
              cardsQuery.error instanceof Error
                ? cardsQuery.error.message
                : 'Không thể kết nối máy chủ.'
            }
            action={
              <Button type="button" onClick={() => void cardsQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : (
          <div className="card-table-wrap">
            <table className="card-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả thẻ trên trang"
                      checked={allVisibleSelected}
                      onChange={toggleVisible}
                    />
                  </th>
                  <th>Mã quản lý</th>
                  <th>Mã thẻ</th>
                  <th>Mệnh giá</th>
                  <th>Tài khoản</th>
                  <FilterHeaderCell
                    as="th"
                    label="Trạng thái"
                    options={STATUS_FILTER_OPTIONS}
                    value={status}
                    baseline={-1}
                    onChange={changeStatus}
                    menuLabel="Lọc theo trạng thái thẻ"
                    clearLabel="Bỏ lọc trạng thái"
                  />
                  <th>Ngày tạo / hết hạn</th>
                  <th>Người sử dụng</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <StateView
                        title={
                          hasActiveFilter
                            ? 'Không có thẻ trong trạng thái này'
                            : 'Chưa có thẻ nào'
                        }
                        description={
                          hasActiveFilter
                            ? 'Chọn trạng thái khác hoặc tạo thẻ mới.'
                            : undefined
                        }
                        action={
                          hasActiveFilter ? (
                            <Button type="button" onClick={clearFilters}>
                              Xóa bộ lọc
                            </Button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  cards.map((card) => {
                    const statusMeta = cardStatusMeta(card.status)
                    return (
                      <tr key={card.cardId}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Chọn thẻ #${card.cardId}`}
                            checked={selectedIds.has(card.cardId)}
                            onChange={() => toggleCard(card.cardId)}
                          />
                        </td>
                        <td>
                          <strong>#{card.cardId}</strong>
                        </td>
                        <td>
                          <code>{card.cardCode || '—'}</code>
                        </td>
                        <td className="card-money">{formatMoney(card.cardValue)}</td>
                        <td>{card.type === 0 ? 'Chính' : 'Khuyến mãi'}</td>
                        <td>
                          <StatusBadge tone={statusMeta.tone}>
                            {statusMeta.label}
                          </StatusBadge>
                          {isCardExpired(card, today) ? (
                            <StatusBadge tone="warning">Hết hạn</StatusBadge>
                          ) : null}
                        </td>
                        <td>
                          <strong>
                            {card.createDate} {card.createTime}
                          </strong>
                          <span>Hết hạn {card.expiryDate || '—'}</span>
                        </td>
                        <td>{card.userName || '—'}</td>
                        <td>{card.note || '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BatchCreateVoucherDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />
      <CredentialFilePrintDialog open={filePrintOpen} kind="voucher" onClose={() => setFilePrintOpen(false)} />

      <ConfirmAction
        open={confirmation === 'lock'}
        title={`Khóa ${lockableIds.length} thẻ chưa dùng`}
        description="Thẻ đã khóa không thể mở lại vì máy chủ hiện chỉ có thao tác khóa."
        confirmLabel="Xác nhận khóa"
        danger
        pending={lockMutation.isPending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => lockMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Máy chủ kiểm tra lại trạng thái từng thẻ. Thẻ đã dùng hoặc đã đổi trạng thái
          sẽ được báo thất bại riêng.
        </InlineAlert>
      </ConfirmAction>

      <ConfirmAction
        open={confirmation === 'delete'}
        title={`Xóa có điều kiện ${selectedIds.size} thẻ`}
        description="Chỉ thẻ đã dùng, đã khóa hoặc thẻ chưa dùng nhưng đã hết hạn mới được xóa."
        confirmLabel="Xác nhận xóa"
        danger
        pending={deleteMutation.isPending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => deleteMutation.mutate()}
      >
        <InlineAlert tone="warning">
          Theo dữ liệu đang hiển thị, {deletableCount}/{selectedIds.size} thẻ đủ điều
          kiện. Máy chủ sẽ kiểm tra lại và giữ nguyên mọi thẻ chưa dùng còn hạn.
        </InlineAlert>
      </ConfirmAction>
    </section>
  )
}
