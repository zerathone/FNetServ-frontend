import {  useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeSlash, MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import {
  getChangePCLogs,
  getTransferLogs,
  getVoucherDetailLogs,
  getVoucherLogs,
  type VoucherLog,
} from '../../api/logs'
import { refundPayment } from '../../api/payment'
import { getUsers, type UserAccount } from '../../api/users'
import { Select,
  Button,
  ConfirmAction,
  DateRangePicker,
  Drawer,
  InlineAlert,
  ListPagination,
  ListToolbar,
  PageHeader,
  RefreshButton,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  R_DELETE_PAYMENT,
  VOUCHER_TRUNCATE_ENABLED,
  hasServiceDetails,
  hasTransferDetails,
  isVoucherRefundable,
  mayHaveChangePCDetails,
  paymentTypeLabel,
} from './transactionModel'
import { TruncateVoucherDialog } from './TruncateVoucherDialog'
import './transactions.css'

const PAGE_SIZE = 50
const R_REFUND_TRANSACTION = 43

type IdentityType = 'member' | 'staff'
type RefundMethod = 'cash' | 'online'

function localToday() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function maskSensitive(value: string | undefined) {
  if (!value) return '—'
  const normalized = value.trim()
  if (normalized.length <= 7) return normalized
  return `${normalized.slice(0, 3)}••••${normalized.slice(-4)}`
}

function identityLabel(user: UserAccount) {
  const name = `${user.lastName || ''} ${user.firstName || ''}`.trim()
  return name ? `${user.userName} · ${name}` : user.userName
}

export function TransactionWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const [fromDate, setFromDate] = useState(localToday)
  const [toDate, setToDate] = useState(localToday)
  const [identityType, setIdentityType] = useState<IdentityType>('member')
  const [searchInput, setSearchInput] = useState('')
  const [identityQuery, setIdentityQuery] = useState('')
  const [selectedIdentity, setSelectedIdentity] = useState<UserAccount | null>(null)
  const [page, setPage] = useState(0)
  const [debtView, setDebtView] = useState(false)
  const [truncateOpen, setTruncateOpen] = useState(false)
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherLog | null>(null)
  const [refundTarget, setRefundTarget] = useState<VoucherLog | null>(null)
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash')
  const refundIntent = useIdempotentIntent('transaction-refund')
  const dateRangeValid = fromDate <= toDate

  const identityResults = useQuery({
    queryKey: ['users', identityType, 'transaction-resolver', identityQuery],
    queryFn: () => getUsers(identityType, 12, 0, identityQuery),
    enabled: identityQuery.length > 0,
  })

  const filterText = selectedIdentity?.userName ?? ''
  const logsQuery = useQuery({
    queryKey: [
      'logs',
      'voucher',
      fromDate,
      toDate,
      page,
      identityType,
      filterText,
      debtView,
    ],
    queryFn: () =>
      getVoucherLogs(
        fromDate,
        toDate,
        PAGE_SIZE,
        page * PAGE_SIZE,
        identityType === 'member' ? 0 : 1,
        filterText,
        debtView,
      ),
    enabled: debtView || dateRangeValid,
    // Công nợ bỏ lọc ngày → mỗi lần tải là quét toàn PaymentTb; tránh refetch khi chỉ đổi focus.
    staleTime: debtView ? 30_000 : 0,
  })

  const serviceDetailsQuery = useQuery({
    queryKey: ['logs', 'voucher', selectedVoucher?.voucherId, 'services'],
    queryFn: () => getVoucherDetailLogs(selectedVoucher!.voucherId),
    enabled:
      selectedVoucher !== null && hasServiceDetails(selectedVoucher.paymentType),
  })
  const transfersQuery = useQuery({
    queryKey: ['logs', 'voucher', selectedVoucher?.voucherId, 'transfers'],
    queryFn: () => getTransferLogs(selectedVoucher!.voucherId),
    enabled:
      selectedVoucher !== null && hasTransferDetails(selectedVoucher.paymentType),
  })
  const changePCQuery = useQuery({
    queryKey: ['logs', 'voucher', selectedVoucher?.voucherId, 'change-pc'],
    queryFn: () => getChangePCLogs(selectedVoucher!.voucherId),
    enabled:
      selectedVoucher !== null &&
      mayHaveChangePCDetails(selectedVoucher.paymentType),
  })

  const logs = logsQuery.data?.items ?? []
  const total = logsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const resolvedUsers = useMemo(
    () => identityResults.data?.items ?? [],
    [identityResults.data],
  )

  const refundMutation = useMutation({
    mutationFn: (voucher: VoucherLog) =>
      refundPayment({
        voucherId: voucher.voucherId,
        method: refundMethod,
        idem: refundIntent.getKey(
          fingerprintIntent({ voucherId: voucher.voucherId, method: refundMethod }),
        ),
      }),
    onSuccess: (response) => {
      refundIntent.clearKey()
      setRefundTarget(null)
      setSelectedVoucher(null)
      pushToast(
        `Đã hoàn ${formatMoney(response.value)} · Phiếu hoàn #${response.refundId}${
          response.loggedOut ? ' · Máy trạm đã đăng xuất vì hết tiền' : ''
        }.`,
        'success',
      )
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const submitIdentitySearch = (event: FormEvent) => {
    event.preventDefault()
    setIdentityQuery(searchInput.trim())
  }

  const selectIdentity = (user: UserAccount) => {
    setSelectedIdentity(user)
    setSearchInput(user.userName)
    setIdentityQuery('')
    setPage(0)
  }

  const clearIdentity = () => {
    setSelectedIdentity(null)
    setSearchInput('')
    setIdentityQuery('')
    setPage(0)
  }

  const openRefund = (voucher: VoucherLog) => {
    refundIntent.clearKey()
    setRefundMethod('cash')
    setRefundTarget(voucher)
  }

  const closeRefund = () => {
    if (refundMutation.isPending) return
    refundIntent.clearKey()
    setRefundTarget(null)
  }

  return (
    <section className="transaction-workspace">
      <PageHeader
        eyebrow="Vận hành"
        title="Nhật ký giao dịch"
      />

      <section className="transaction-filters" aria-label="Bộ lọc giao dịch">
        <div className="transaction-filters__fields">
          {debtView ? null : (
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              onFromDateChange={(value) => { setFromDate(value); setPage(0) }}
              onToDateChange={(value) => { setToDate(value); setPage(0) }}
            />
          )}
          <form className="transaction-search" onSubmit={submitIdentitySearch} style={{ flex: 1 }}>
            <label className="ds-field" style={{ flex: 1 }}>
              <span className="ds-visually-hidden">Tìm kiếm</span>
              <div className="ds-input-group ds-input-group--search">
                <Select
                  value={identityType}
                  onChange={(event) => {
                    setIdentityType(event.target.value as IdentityType)
                    clearIdentity()
                  }}
                >
                  <option value="member">Hội viên</option>
                  <option value="staff">Nhân viên</option>
                </Select>
                <div className="ds-search-input">
                  <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                  <input
                    className="ds-input"
                    type="search"
                    value={searchInput}
                    placeholder="Tìm và chọn đúng người"
                    onChange={(event) => {
                      setSearchInput(event.target.value)
                      if (selectedIdentity) setSelectedIdentity(null)
                    }}
                  />
                  {searchInput || selectedIdentity ? (
                    <button type="button" className="ds-search-input__clear" aria-label="Xóa bộ lọc" onClick={clearIdentity}>
                      <XCircle size={18} weight="fill" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            </label>
          </form>
          <div className="transaction-filters__actions">
            <Button
              type="button"
              variant={debtView ? 'primary' : 'secondary'}
              aria-pressed={debtView}
              icon={
                debtView
                  ? <EyeSlash size={18} weight="bold" aria-hidden="true" />
                  : <Eye size={18} weight="bold" aria-hidden="true" />
              }
              onClick={() => { setDebtView((value) => !value); setPage(0) }}
            >
              {debtView ? 'Bỏ xem công nợ' : 'Xem công nợ'}
            </Button>
            {VOUCHER_TRUNCATE_ENABLED && hasRight(R_DELETE_PAYMENT) ? (
              <Button type="button" variant="danger-outline" onClick={() => setTruncateOpen(true)}>
                Xóa nhật ký
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {debtView ? (
        <InlineAlert tone="info">
          Đang xem toàn bộ công nợ (phiếu chưa thanh toán), không giới hạn theo ngày.
        </InlineAlert>
      ) : null}

      {!debtView && !dateRangeValid ? (
        <InlineAlert tone="danger">Ngày bắt đầu không được sau ngày kết thúc.</InlineAlert>
      ) : null}

      {identityQuery ? (
        <section className="transaction-resolver" aria-label="Kết quả xác minh danh tính">
          <div className="transaction-resolver__header">
            <div>
              <strong>Kết quả xác minh</strong>
              <span>Chọn một người để lọc nhật ký bằng tài khoản đã xác thực.</span>
            </div>
            <Button type="button" variant="ghost" onClick={() => setIdentityQuery('')}>
              Đóng
            </Button>
          </div>
          {identityResults.isLoading ? (
            <StateView title="Đang tìm người dùng…" />
          ) : identityResults.isError ? (
            <StateView
              title="Không thể tìm người dùng"
              description={
                identityResults.error instanceof Error
                  ? identityResults.error.message
                  : undefined
              }
            />
          ) : resolvedUsers.length === 0 ? (
            <StateView
              title="Không tìm thấy người phù hợp"
              description="Kiểm tra lại tài khoản, số điện thoại hoặc CCCD."
            />
          ) : (
            <div className="transaction-resolver__list">
              {resolvedUsers.map((user) => (
                <button
                  type="button"
                  key={user.userId}
                  onClick={() => selectIdentity(user)}
                >
                  <strong>{identityLabel(user)}</strong>
                  <span>
                    {maskSensitive(user.phone)} · {maskSensitive(user.idNumber)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {selectedIdentity ? (
        <InlineAlert tone="info">
          Đang lọc giao dịch của <strong>{identityLabel(selectedIdentity)}</strong>.
          SĐT và CCCD chỉ dùng để xác minh, truy vấn nhật ký gửi tài khoản đã chọn.
        </InlineAlert>
      ) : null}

      {logsQuery.data?.viewAllVoucher === false ? (
        <InlineAlert tone="info">
          Tài khoản hiện tại chỉ được xem giao dịch do chính mình thực hiện.
        </InlineAlert>
      ) : null}

      <section className="transaction-panel" aria-label="Danh sách giao dịch">
        <ListToolbar
          count={<>Tổng <strong>{new Intl.NumberFormat('vi-VN').format(total)}</strong></>}
          actions={
            <>
              <RefreshButton loading={logsQuery.isFetching} onClick={() => void logsQuery.refetch()} />
              <ListPagination
                page={page}
                totalPages={totalPages}
                canNext={page < totalPages - 1}
                onPrevious={() => setPage((value) => Math.max(0, value - 1))}
                onNext={() => setPage((value) => value + 1)}
              />
            </>
          }
        />

        <div className="transaction-table-wrap">
          <table className="transaction-table">
            <thead>
              <tr>
                <th>Giao dịch</th>
                <th>Đối tượng</th>
                <th>Loại</th>
                <th>Thời gian</th>
                <th>Nhân viên</th>
                <th className="transaction-money">Số tiền</th>
                <th aria-label="Mở chi tiết" />
              </tr>
            </thead>
            <tbody>
              {logsQuery.isLoading ? (
                <tr>
                  <td colSpan={7} className="transaction-table__empty">
                    Đang tải nhật ký…
                  </td>
                </tr>
              ) : logsQuery.isError ? (
                <tr>
                  <td colSpan={7} className="transaction-table__empty">
                    <p>
                      Không tải được nhật ký —{' '}
                      {logsQuery.error instanceof Error
                        ? logsQuery.error.message
                        : 'Không thể kết nối máy chủ.'}
                    </p>
                    <Button type="button" onClick={() => void logsQuery.refetch()}>
                      Thử lại
                    </Button>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="transaction-table__empty">
                    Không có giao dịch phù hợp — thử đổi ngày hoặc bỏ bộ lọc người dùng.
                  </td>
                </tr>
              ) : (
                logs.map((voucher) => (
                  <tr key={voucher.voucherId}>
                    <td>
                      <strong>#{voucher.voucherId}</strong>
                      {voucher.voucherNo === 'recall' ? (
                        <StatusBadge tone="neutral">Đã hoàn</StatusBadge>
                      ) : null}
                    </td>
                    <td>
                      <strong>{voucher.userName || '—'}</strong>
                      <span>{voucher.machineName || 'Không gắn máy'}</span>
                    </td>
                    <td>
                      <strong>{paymentTypeLabel(voucher.paymentType)}</strong>
                      <span>{voucher.note || 'Không có ghi chú'}</span>
                    </td>
                    <td>
                      <strong>{voucher.voucherTime}</strong>
                      <span>{voucher.voucherDate}</span>
                    </td>
                    <td>{voucher.staffName || '—'}</td>
                    <td
                      className={`transaction-money ${
                        voucher.amount < 0 ? 'is-negative' : ''
                      }`}
                    >
                      {formatMoney(voucher.amount)}
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedVoucher(voucher)}
                      >
                        Chi tiết
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={selectedVoucher !== null}
        title={selectedVoucher ? `Giao dịch #${selectedVoucher.voucherId}` : 'Giao dịch'}
        description={
          selectedVoucher
            ? `${selectedVoucher.voucherDate} ${selectedVoucher.voucherTime}`
            : undefined
        }
        onClose={() => setSelectedVoucher(null)}
        footer={
          selectedVoucher ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelectedVoucher(null)}
              >
                Đóng
              </Button>
              {isVoucherRefundable(selectedVoucher) &&
              hasRight(R_REFUND_TRANSACTION) ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => openRefund(selectedVoucher)}
                >
                  Hoàn toàn bộ
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {selectedVoucher ? (
          <div className="transaction-detail">
            <dl className="transaction-detail__summary">
              <div>
                <dt>Khách / tài khoản</dt>
                <dd>{selectedVoucher.userName || '—'}</dd>
              </div>
              <div>
                <dt>Máy</dt>
                <dd>{selectedVoucher.machineName || 'Không gắn máy'}</dd>
              </div>
              <div>
                <dt>Loại</dt>
                <dd>{paymentTypeLabel(selectedVoucher.paymentType)}</dd>
              </div>
              <div>
                <dt>Nhân viên</dt>
                <dd>{selectedVoucher.staffName || '—'}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd>{selectedVoucher.note || '—'}</dd>
              </div>
              <div className="transaction-detail__total">
                <dt>Số tiền</dt>
                <dd>{formatMoney(selectedVoucher.amount)}</dd>
              </div>
            </dl>

            {hasServiceDetails(selectedVoucher.paymentType) ? (
              <section className="transaction-detail__section">
                <h3>Chi tiết dịch vụ</h3>
                {serviceDetailsQuery.isLoading ? (
                  <p>Đang tải…</p>
                ) : serviceDetailsQuery.isError ? (
                  <InlineAlert tone="danger">
                    Không tải được chi tiết dịch vụ.
                  </InlineAlert>
                ) : (serviceDetailsQuery.data ?? []).length === 0 ? (
                  <p>Không có dòng dịch vụ.</p>
                ) : (
                  <div className="transaction-detail__rows">
                    {serviceDetailsQuery.data?.map((item) => (
                      <div key={item.serviceDetailId}>
                        <span>
                          {item.quantity} × {item.serviceName}
                        </span>
                        <strong>{formatMoney(item.amount)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {hasTransferDetails(selectedVoucher.paymentType) ? (
              <section className="transaction-detail__section">
                <h3>Lịch sử chuyển phí</h3>
                {transfersQuery.isLoading ? (
                  <p>Đang tải…</p>
                ) : transfersQuery.isError ? (
                  <InlineAlert tone="danger">
                    Không tải được lịch sử chuyển phí.
                  </InlineAlert>
                ) : (transfersQuery.data ?? []).length === 0 ? (
                  <p>Không có dòng chuyển phí.</p>
                ) : (
                  <div className="transaction-detail__rows">
                    {transfersQuery.data?.map((item) => (
                      <div key={item.id}>
                        <span>
                          {item.fromUserName || '—'} →{' '}
                          {item.toUserName || '—'}
                        </span>
                        <strong>
                          {item.transferDate} {item.transferTime}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {mayHaveChangePCDetails(selectedVoucher.paymentType) ? (
              <section className="transaction-detail__section">
                <h3>Quá trình sử dụng máy</h3>
                {changePCQuery.isLoading ? (
                  <p>Đang tải…</p>
                ) : changePCQuery.isError ? (
                  <InlineAlert tone="danger">
                    Không tải được quá trình sử dụng máy.
                  </InlineAlert>
                ) : (changePCQuery.data?.items ?? []).length === 0 ? (
                  <p>Không có lần chuyển máy trong giao dịch này.</p>
                ) : (
                  <>
                    <div className="transaction-detail__rows">
                      {changePCQuery.data?.items.map((item) => (
                        <div key={item.id}>
                          <span>{item.machineName}</span>
                          <strong>{formatMoney(item.moneyUsed)}</strong>
                        </div>
                      ))}
                    </div>
                    <p className="transaction-detail__sum">
                      Tổng tiền sử dụng thô từ server:{' '}
                      <strong>{formatMoney(changePCQuery.data?.sumMoneyUsed ?? 0)}</strong>
                    </p>
                  </>
                )}
              </section>
            ) : null}

            {isVoucherRefundable(selectedVoucher) &&
            !hasRight(R_REFUND_TRANSACTION) ? (
              <InlineAlert tone="warning">
                Giao dịch có thể hoàn nhưng tài khoản hiện tại thiếu quyền Hoàn giao
                dịch.
              </InlineAlert>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      {VOUCHER_TRUNCATE_ENABLED ? (
        <TruncateVoucherDialog open={truncateOpen} onClose={() => setTruncateOpen(false)} />
      ) : null}

      <ConfirmAction
        open={refundTarget !== null}
        title="Hoàn toàn bộ giao dịch"
        description="Máy chủ luôn hoàn toàn bộ giá trị voucher; không hỗ trợ hoàn một phần."
        confirmLabel="Xác nhận hoàn"
        danger
        pending={refundMutation.isPending}
        onCancel={closeRefund}
        onConfirm={() => {
          if (refundTarget) refundMutation.mutate(refundTarget)
        }}
      >
        {refundTarget ? (
          <div className="transaction-refund">
            <dl>
              <div>
                <dt>Giao dịch gốc</dt>
                <dd>#{refundTarget.voucherId}</dd>
              </div>
              <div>
                <dt>Khách hàng</dt>
                <dd>{refundTarget.userName || '—'}</dd>
              </div>
              <div>
                <dt>Giá trị hoàn</dt>
                <dd>{formatMoney(refundTarget.amount)}</dd>
              </div>
            </dl>
            <fieldset>
              <legend>Kênh trả tiền cho khách</legend>
              <label>
                <input
                  type="radio"
                  name="refund-method"
                  checked={refundMethod === 'cash'}
                  onChange={() => setRefundMethod('cash')}
                />
                Tiền mặt
              </label>
              <label>
                <input
                  type="radio"
                  name="refund-method"
                  checked={refundMethod === 'online'}
                  onChange={() => setRefundMethod('online')}
                />
                Online
              </label>
            </fieldset>
            <InlineAlert tone="warning">
              Nếu hội viên đang online, máy chủ sẽ đọc lại số dư và có thể đăng xuất
              máy trạm khi số dư sau hoàn không còn đủ.
            </InlineAlert>
          </div>
        ) : null}
      </ConfirmAction>
    </section>
  )
}
