import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi } from '../../api/cards'
import {
  Button,
  ConfirmAction,
  InlineAlert,
  ListPagination,
  PageHeader,
  RefreshButton,
  StateView,
  StatusBadge,
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

type Confirmation = 'lock' | 'delete' | null

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
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const [status, setStatus] = useState(-1)
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [filePrintOpen, setFilePrintOpen] = useState(false)
  const today = localDateAfter(0)

  const cardsQuery = useQuery({
    queryKey: ['cards', status, page],
    queryFn: () =>
      cardsApi.getList({
        status,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  })

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
            <Button
              type="button"
              variant="secondary"
              disabled
              title="Chưa có API đọc tồn bán khả dụng tương đương màn Qt."
            >
              Bán thẻ · chưa khả dụng
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

      <InlineAlert tone="info">
        Bán thẻ tại quầy đang được bảo vệ: endpoint ghi tiền đã có nhưng máy chủ chưa
        cung cấp danh sách tồn bán khả dụng giống màn Qt. WebUI không cho nhập mệnh giá
        và số lượng tùy ý để tránh bán vượt tồn.
      </InlineAlert>

      <nav className="card-status-tabs" aria-label="Lọc trạng thái thẻ">
        {[
          { value: -1, label: 'Tất cả' },
          { value: 0, label: 'Chưa dùng' },
          { value: 1, label: 'Đã dùng' },
          { value: 2, label: 'Đã khóa' },
        ].map((item) => (
          <button
            type="button"
            className={status === item.value ? 'is-active' : ''}
            aria-pressed={status === item.value}
            key={item.value}
            onClick={() => changeStatus(item.value)}
          >
            {item.label}
            {status === item.value ? <strong>{total}</strong> : null}
          </button>
        ))}
      </nav>

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
          <div>
            <strong>{new Intl.NumberFormat('vi-VN').format(total)} thẻ</strong>
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
        ) : cards.length === 0 ? (
          <StateView
            title="Không có thẻ trong trạng thái này"
            description="Chọn trạng thái khác hoặc tạo thẻ mới."
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
                  <th>Mệnh giá</th>
                  <th>Ví</th>
                  <th>Trạng thái</th>
                  <th>Ngày tạo / hết hạn</th>
                  <th>Người sử dụng</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => {
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
                      <td className="card-money">{formatMoney(card.cardValue)}</td>
                      <td>{card.type === 0 ? 'Ví chính' : 'Ví khuyến mãi'}</td>
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
                })}
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
