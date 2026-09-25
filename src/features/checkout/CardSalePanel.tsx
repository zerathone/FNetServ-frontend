import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreditCard } from '@phosphor-icons/react'
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
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  const total = lines.reduce((sum, line) => sum + line.cardValue * line.quantity, 0)

  const setQuantity = (cardValue: number, raw: number) => {
    const stock = stockByValue.get(cardValue) ?? 0
    const quantity = Math.max(0, Math.min(stock, Math.floor(raw) || 0))
    setQuantities((current) => ({ ...current, [cardValue]: quantity }))
  }

  const resetForm = () => setQuantities({})

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error('Hãy chọn số lượng ít nhất một mệnh giá thẻ nạp.')
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
    <section className="checkout-panel card-sale-pos" aria-labelledby="card-sale-title">
      <div className="checkout-panel__header">
        <div>
          <h2 id="card-sale-title">Bán thẻ nạp tiền</h2>
          <p>Chọn số lượng theo mệnh giá còn tồn kho · khách thanh toán tiền mặt và mang thẻ về</p>
        </div>
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
        <div className={`card-sale-pos__layout ${lines.length ? 'has-context' : ''}`}>
          <div className="card-sale-pos__catalog-area">
            <div className="card-sale-pos__catalog">
              {catalog.map((row: RechargeCardAvailable) => {
                const quantity = quantities[row.cardValue] ?? 0
                const remaining = row.quantity - quantity
                const outOfStock = row.quantity === 0
                return (
                  <article
                    className={`card-sale-product-card${quantity > 0 ? ' is-selected' : ''}${outOfStock ? ' is-unavailable' : ''}`}
                    key={row.cardValue}
                  >
                    <div className="card-sale-product-card__eyebrow">
                      <span className="card-sale-product-card__name">
                        <CreditCard size={16} weight="duotone" />
                        Thẻ nạp tiền
                      </span>
                      <StatusBadge tone={outOfStock ? 'warning' : quantity > 0 ? 'success' : 'info'}>
                        {outOfStock ? 'Hết hàng' : `Còn ${row.quantity} thẻ`}
                      </StatusBadge>
                    </div>

                    <div className="card-sale-product-card__headline">
                      <strong className="card-sale-product-card__price">{formatMoney(row.cardValue)}</strong>
                      <span className="card-sale-product-card__unit">/ thẻ</span>
                    </div>

                    <div className="card-sale-product-card__footer">
                      <span className="card-sale-product-card__qty-label">Số lượng</span>
                      <div className="card-sale-quantity" aria-label={`Số lượng thẻ ${formatMoney(row.cardValue)}`}>
                        <button
                          type="button"
                          aria-label="Giảm số lượng"
                          disabled={quantity <= 0}
                          onClick={() => setQuantity(row.cardValue, quantity - 1)}
                        >
                          −
                        </button>
                        <input
                          aria-label="Số lượng"
                          type="number"
                          min={0}
                          max={row.quantity}
                          value={quantity}
                          disabled={outOfStock}
                          onChange={(event) => setQuantity(row.cardValue, Number(event.target.value))}
                        />
                        <button
                          type="button"
                          aria-label="Tăng số lượng"
                          disabled={quantity >= row.quantity}
                          onClick={() => setQuantity(row.cardValue, quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className={`card-sale-product-card__remaining${remaining <= 0 ? ' is-empty' : ''}`}>
                      Còn lại: <strong>{remaining}</strong> thẻ trong kho
                    </div>
                  </article>
                )
              })}
            </div>
          </div>

          {lines.length ? (
            <aside className="card-sale-context" aria-label="Phiếu bán thẻ nạp">
              <header>
                <div>
                  <span>Phiếu bán</span>
                  <h3>Thẻ nạp đã chọn</h3>
                </div>
                <StatusBadge tone="success">{totalQuantity} thẻ</StatusBadge>
              </header>

              <div className="card-sale-context__lines">
                {lines.map((line) => (
                  <article key={line.cardValue}>
                    <div className="card-sale-context__line-title">
                      <div>
                        <strong>{formatMoney(line.cardValue)} / thẻ</strong>
                        <span>Số lượng: {line.quantity}</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Bỏ mệnh giá ${formatMoney(line.cardValue)}`}
                        onClick={() => setQuantity(line.cardValue, 0)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="card-sale-context__line-bottom">
                      <span>Thành tiền</span>
                      <strong>{formatMoney(line.cardValue * line.quantity)}</strong>
                    </div>
                  </article>
                ))}
              </div>

              <div className="card-sale-context__checkout">
                <p className="card-sale__note">
                  Lưu ý: doanh thu từ thẻ nạp tiền thuộc loại thời gian phí.
                </p>
                <dl>
                  <div><dt>Số loại</dt><dd>{lines.length}</dd></div>
                  <div><dt>Số thẻ</dt><dd>{totalQuantity}</dd></div>
                  <div className="card-sale-context__total"><dt>Tổng thanh toán</dt><dd>{formatMoney(total)}</dd></div>
                </dl>
                <Button
                  variant="primary"
                  block
                  loading={saleMutation.isPending}
                  disabled={!lines.length}
                  onClick={() => saleMutation.mutate()}
                >
                  Thanh toán
                </Button>
                <button type="button" className="card-sale-context__clear" onClick={resetForm}>
                  Bỏ toàn bộ lựa chọn
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  )
}
