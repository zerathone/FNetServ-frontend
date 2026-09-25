import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cardsApi, type RechargeCardAvailable } from '../../api/cards'
import { Button, StateView, StatusBadge } from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function CardSalePanel() {
  const { getKey, clearKey } = useIdempotentIntent('card-recharge')
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  const [quantities, setQuantities] = useState<Record<number, number>>({})

  const catalogQuery = useQuery({
    queryKey: ['card-recharge', 'available'],
    queryFn: () => cardsApi.getRechargeAvailable(),
  })
  const catalog = catalogQuery.data?.items ?? []
  const stockByValue = useMemo(
    () => new Map((catalogQuery.data?.items ?? []).map((row) => [row.cardValue, row.quantity])),
    [catalogQuery.data],
  )

  const lines = useMemo(
    () =>
      Object.entries(quantities)
        .map(([cardValue, quantity]) => ({ cardValue: Number(cardValue), quantity }))
        .filter((line) => line.quantity > 0),
    [quantities],
  )
  const total = lines.reduce(
    (sum, line) => sum + line.cardValue * line.quantity,
    0,
  )

  const setQuantity = (cardValue: number, raw: number) => {
    const stock = stockByValue.get(cardValue) ?? 0
    const quantity = Math.max(0, Math.min(stock, Math.floor(raw) || 0))
    setQuantities((current) => ({ ...current, [cardValue]: quantity }))
  }

  const resetForm = () => setQuantities({})

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('Hãy nhập số lượng ít nhất một mệnh giá thẻ nạp.')
      if (!staffId) throw new Error('Không xác định được nhân viên đang đăng nhập.')
      for (const line of lines) {
        const stock = stockByValue.get(line.cardValue) ?? 0
        if (line.quantity > stock) {
          throw new Error(`Mệnh giá ${formatMoney(line.cardValue)} chỉ còn ${stock} thẻ trong kho.`)
        }
      }
      const idem = getKey(fingerprintIntent({ staffId, lines }))
      return cardsApi.sellRechargeCards({
        staffId,
        total,
        idem,
        items: lines.map((line) => ({
          cardValue: line.cardValue,
          quantity: line.quantity,
          amount: line.cardValue * line.quantity,
        })),
      })
    },
    onSuccess: (response) => {
      clearKey()
      pushToast(`Đã bán thẻ nạp · phiếu #${response.voucherId}.`, 'success')
      resetForm()
      void invalidateMoneyQueries(queryClient)
      void catalogQuery.refetch()
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  return (
    <section className="checkout-panel card-sale" aria-labelledby="card-sale-title">
      <div className="checkout-panel__header">
        <div>
          <h2 id="card-sale-title">Bán thẻ nạp tiền</h2>
          <p>Chọn số lượng theo mệnh giá còn tồn kho · khách thanh toán tiền mặt và mang thẻ về</p>
        </div>
        <StatusBadge tone="info">Tồn kho do máy chủ xác nhận</StatusBadge>
      </div>

      {catalogQuery.isLoading ? (
        <StateView title="Đang tải danh mục thẻ nạp…" />
      ) : catalogQuery.isError ? (
        <StateView
          title="Không tải được danh mục thẻ nạp"
          description={(catalogQuery.error as Error).message}
          action={<Button onClick={() => void catalogQuery.refetch()}>Thử lại</Button>}
        />
      ) : catalog.length === 0 ? (
        <StateView title="Kho thẻ nạp đang trống" description="Cần sinh thêm thẻ ở trang Thẻ nạp trước khi bán." />
      ) : (
        <>
          <div className="card-sale-table-wrap">
            <table className="card-sale-table">
              <thead>
                <tr>
                  <th>Mệnh giá (VNĐ)</th>
                  <th>Số lượng</th>
                  <th>Đơn vị tính</th>
                  <th className="card-sale-table__amount">Thành tiền (VNĐ)</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((row: RechargeCardAvailable) => {
                  const quantity = quantities[row.cardValue] ?? 0
                  return (
                    <tr key={row.cardValue}>
                      <td>{formatMoney(row.cardValue)}</td>
                      <td>
                        <input
                          className="card-sale-table__qty"
                          type="number"
                          min={0}
                          max={row.quantity}
                          value={quantity}
                          onChange={(event) =>
                            setQuantity(row.cardValue, Number(event.target.value))
                          }
                        />
                        <span className="card-sale-table__stock">/ {row.quantity} còn lại</span>
                      </td>
                      <td>thẻ</td>
                      <td className="card-sale-table__amount">
                        {formatMoney(row.cardValue * quantity)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="card-sale__note">
            Lưu ý: doanh thu từ thẻ nạp tiền thuộc loại thời gian phí.
          </p>

          <div className="card-sale__footer">
            <button type="button" className="card-sale__clear" onClick={resetForm} disabled={!lines.length}>
              Hủy bỏ
            </button>
            <div className="card-sale__total">
              <span>Tổng tiền (VNĐ)</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <Button
              variant="primary"
              loading={saleMutation.isPending}
              disabled={!lines.length}
              onClick={() => saleMutation.mutate()}
            >
              Thanh toán
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
