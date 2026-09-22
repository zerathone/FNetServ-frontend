import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRechargeHistory, getUserLogs, type UserAccount } from '../../api/users'
import { Button, DateRangePicker, Dialog, StateView } from '../../design-system/components'

export type CustomerHistoryKind = 'usage' | 'recharge'

type CustomerHistoryDialogProps = {
  kind: CustomerHistoryKind | null
  user: UserAccount
  onClose: () => void
}

function formatMoney(value: number | string | null | undefined) {
  const amount = typeof value === 'string' ? Number(value) : value
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  return `${new Intl.NumberFormat('vi-VN').format(amount)} đ`
}

function formatDateTime(date: string, time: string) {
  if (!date && !time) return '—'
  const [year, month, day] = date.split('-')
  const displayDate = year && month && day ? `${day}/${month}/${year}` : date
  return [displayDate, time].filter(Boolean).join(' · ')
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const parts = [hours ? `${hours} giờ` : '', minutes ? `${minutes} phút` : ''].filter(Boolean)
  return parts.join(' ') || '< 1 phút'
}

function rechargeMethodLabel(paymentType: number) {
  switch (paymentType) {
    case 4:
      return 'Tiền mặt'
    case 13:
      return 'Thẻ nạp'
    case 20:
      return 'Chuyển khoản'
    case 26:
      return 'QR'
    case 29:
      return 'Cấn trừ'
    default:
      return `Giao dịch khác (${paymentType})`
  }
}

export function CustomerHistoryDialog({ kind, user, onClose }: CustomerHistoryDialogProps) {
  const isRecharge = kind === 'recharge'
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    if (kind) {
      setFromDate('')
      setToDate('')
    }
  }, [kind, user.userId])

  // Backend chỉ nhận cặp from/to đủ cả hai (§20.7) — gửi một đầu mút là lỗi.
  const range = fromDate && toDate ? { from: fromDate, to: toDate } : {}
  const rechargeQuery = useQuery({
    queryKey: ['user-recharge-history', user.userId, range.from, range.to],
    queryFn: () => getRechargeHistory(user.userId, range),
    enabled: isRecharge,
  })
  const usageQuery = useQuery({
    queryKey: ['user-usage-logs', user.userId, range.from, range.to],
    queryFn: () => getUserLogs(user.userId, 200, 0, range),
    enabled: kind === 'usage',
  })

  const query = isRecharge ? rechargeQuery : usageQuery
  const rechargeRows = rechargeQuery.data?.items ?? []
  const usageRows = usageQuery.data ?? []
  const isEmpty = isRecharge ? rechargeRows.length === 0 : usageRows.length === 0

  return (
    <Dialog
      open={kind !== null}
      title={isRecharge ? 'Nhật ký nạp tiền' : 'Nhật ký sử dụng'}
      description={`${user.userName} · ${`${user.lastName || ''} ${user.firstName || ''}`.trim() || 'Chưa cập nhật'}`}
      size="lg"
      onClose={onClose}
      footer={<Button type="button" variant="secondary" onClick={onClose}>Đóng</Button>}
    >
      <div className="customer-history-dialog">
        <DateRangePicker
          label="Lọc theo khoảng ngày"
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />

        {isRecharge && rechargeQuery.data ? (
          <div className="customer-history-dialog__total">
            <span>Tổng đã nạp</span>
            <strong>{formatMoney(rechargeQuery.data.total)}</strong>
          </div>
        ) : null}

        {query.isLoading ? <StateView title="Đang tải lịch sử…" /> : null}
        {query.isError ? (
          <StateView
            title="Không tải được lịch sử"
            description={query.error instanceof Error ? query.error.message : undefined}
            action={<Button type="button" variant="secondary" onClick={() => void query.refetch()}>Thử lại</Button>}
          />
        ) : null}
        {!query.isLoading && !query.isError && isEmpty ? (
          <StateView title={isRecharge ? 'Chưa có lần nạp nào' : 'Chưa có phiên sử dụng nào'} />
        ) : null}

        {!query.isLoading && !query.isError && !isEmpty ? (
          <div className="customer-history-dialog__table-wrap">
            {isRecharge ? (
              <table className="customer-history-dialog__table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Phương thức</th>
                    <th>Nhân viên</th>
                    <th className="is-number">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {rechargeRows.map((entry, index) => (
                    <tr key={`${entry.voucherNo}-${entry.voucherDate}-${index}`}>
                      <td>
                        <strong>{formatDateTime(entry.voucherDate, entry.voucherTime)}</strong>
                        {entry.note ? <small>{entry.note}</small> : null}
                      </td>
                      <td>{rechargeMethodLabel(entry.paymentType)}</td>
                      <td>{entry.staffName || '—'}</td>
                      <td className="is-number"><strong>{formatMoney(entry.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="customer-history-dialog__table">
                <thead>
                  <tr>
                    <th>Máy trạm</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th className="is-number">Thời lượng</th>
                    <th className="is-number">Đã dùng</th>
                  </tr>
                </thead>
                <tbody>
                  {usageRows.map((entry, index) => (
                    <tr key={`${entry.machineName}-${entry.enterDate}-${entry.enterTime}-${index}`}>
                      <td>
                        <strong>{entry.machineName || '—'}</strong>
                        {entry.ipAddress ? <small>{entry.ipAddress}</small> : null}
                      </td>
                      <td>{formatDateTime(entry.enterDate, entry.enterTime)}</td>
                      <td>{formatDateTime(entry.endDate, entry.endTime)}</td>
                      <td className="is-number">{formatDuration(entry.timeUsed)}</td>
                      <td className="is-number"><strong>{formatMoney(entry.moneyUsed)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
