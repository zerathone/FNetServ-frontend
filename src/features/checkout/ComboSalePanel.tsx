import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarBlank, Clock, MapPin, BowlFood } from '@phosphor-icons/react'
import {
  getComboQrStatus,
  getComboCatalog,
  sellCombos,
  startComboQr,
  type Combo,
  type ComboSaleResult,
} from '../../api/combo'
import {
  Button,
  Dialog,
  InlineAlert,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { pushToast } from '../../store/toast'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { comboUsagePresentation } from './comboUsageModel'

type CartLine = { combo: Combo; quantity: number }

const WEEKDAYS = [
  ['T2', 1 << 1],
  ['T3', 1 << 2],
  ['T4', 1 << 3],
  ['T5', 1 << 4],
  ['T6', 1 << 5],
  ['T7', 1 << 6],
  ['CN', 1 << 0],
] as const

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function qrSource(value: string) {
  return value.startsWith('data:image/') ? value : `data:image/png;base64,${value}`
}

function formatDuration(hours: number) {
  if (hours <= 0) return 'Không giới hạn thời lượng'
  return `${hours} tiếng`
}

function formatWeekdays(mask: number) {
  if (mask === 127) return 'T2–CN'
  const days = WEEKDAYS.filter(([, bit]) => (mask & bit) !== 0).map(([label]) => label)
  return days.length ? days.join(', ') : 'Chưa chọn ngày'
}

function formatUsageTime(combo: Combo) {
  const schedules = new Set(
    combo.machineGroups.map((group) =>
      combo.type === 1
        ? `${String(group.fromTime).padStart(2, '0')}:00 – ${String(group.toTime).padStart(2, '0')}:00`
        : `${String(group.fromTime).padStart(2, '0')}:00`,
    ),
  )
  if (schedules.size === 0) return 'Chưa có giờ dùng'
  if (schedules.size > 1) return `${schedules.size} khung giờ`
  return [...schedules][0]
}

export function ComboSalePanel() {
  // Backend giới hạn idem COMBO ở 46 ký tự vì còn nối hậu tố #<n>.
  const { getKey, clearKey } = useIdempotentIntent('cs')
  const queryClient = useQueryClient()
  const [cart, setCart] = useState<CartLine[]>([])
  const [machineGroupFilter, setMachineGroupFilter] = useState<number | null>(null)
  const [method, setMethod] = useState<'cash' | 'online' | 'qr'>('cash')
  const [results, setResults] = useState<ComboSaleResult[]>([])
  const [qr, setQr] = useState<{
    orderId: string
    img: string
    expiresAt: number
    bank: string
    account: string
    value: number
  } | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [clockMs, setClockMs] = useState(() => Date.now())

  const comboQuery = useQuery({
    queryKey: ['combos', 'active'],
    queryFn: () => getComboCatalog('active'),
  })
  const catalog = useMemo(
    () => (comboQuery.data?.items ?? []).filter((combo) => combo.status === 1),
    [comboQuery.data],
  )
  const machineGroups = useMemo(() => {
    const groups = new Map<number, string>()
    catalog.forEach((combo) =>
      combo.machineGroups.forEach((group) => groups.set(group.machineGroupId, group.name)),
    )
    return [...groups.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
  }, [catalog])
  const visibleCatalog = useMemo(
    () =>
      machineGroupFilter === null
        ? catalog
        : catalog.filter((combo) =>
            combo.machineGroups.some((group) => group.machineGroupId === machineGroupFilter),
          ),
    [catalog, machineGroupFilter],
  )
  const cartIds = useMemo(() => new Set(cart.map((line) => line.combo.comboId)), [cart])
  const totalQuantity = cart.reduce((sum, line) => sum + line.quantity, 0)
  const total = cart.reduce((sum, line) => sum + line.combo.price * line.quantity, 0)
  const serverNowMs = comboQuery.data
    ? comboQuery.data.serverTimeMs + (Math.max(clockMs, comboQuery.data.receivedAtMs) - comboQuery.data.receivedAtMs)
    : clockMs

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectCombo = (combo: Combo) => {
    if (!combo.salableNow) return
    setCart((current) =>
      current.some((line) => line.combo.comboId === combo.comboId)
        ? current
        : [...current, { combo, quantity: 1 }],
    )
  }

  const changeQuantity = (comboId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart((current) => current.filter((line) => line.combo.comboId !== comboId))
      return
    }
    setCart((current) =>
      current.map((line) =>
        line.combo.comboId === comboId
          ? { ...line, quantity: Math.min(99, quantity) }
          : line,
      ),
    )
  }

  const saleMutation = useMutation({
    mutationFn: async () => {
      if (!cart.length) throw new Error('Hãy chọn ít nhất một COMBO.')
      const fingerprint = fingerprintIntent({
        method,
        lines: cart.map((line) => ({
          comboId: line.combo.comboId,
          quantity: line.quantity,
        })),
      })
      const baseIdem = getKey(fingerprint).slice(0, 41)
      const combos = cart.map((line, index) => ({
        comboId: line.combo.comboId,
        quantity: line.quantity,
        idem: `${baseIdem}-${index}`,
      }))

      if (method === 'qr') {
        const response = await startComboQr({
          orderName: `COMBO x${totalQuantity}`,
          combos,
        })
        setQr({
          orderId: response.orderId,
          img: qrSource(response.img),
          expiresAt: Date.now() + response.exprSec * 1000,
          bank: response.bankShortName || response.bankName,
          account: response.bankAccount,
          value: response.value,
        })
        setRemaining(response.exprSec)
        return null
      }

      return sellCombos({ paymentMethod: method, combos })
    },
    onSuccess: (response) => {
      if (!response) return
      clearKey()
      setResults(response.results)
      pushToast(`Đã phát hành ${response.results.length} thẻ COMBO.`, 'success')
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const statusQuery = useQuery({
    queryKey: ['combo-sale-qr', qr?.orderId],
    queryFn: () => getComboQrStatus(qr!.orderId),
    enabled: Boolean(qr?.orderId),
    refetchInterval: (query) =>
      ['done', 'error', 'failed', 'expired'].includes(query.state.data?.state ?? '')
        ? false
        : 1_000,
    retry: false,
  })

  useEffect(() => {
    if (!qr) return
    const timer = window.setInterval(
      () => setRemaining(Math.max(0, Math.ceil((qr.expiresAt - Date.now()) / 1_000))),
      1_000,
    )
    return () => window.clearInterval(timer)
  }, [qr])

  useEffect(() => {
    const status = statusQuery.data
    if (!status) return
    if (status.state === 'done' && status.results) {
      clearKey()
      setQr(null)
      setResults(status.results)
      pushToast(
        `Thanh toán QR thành công · đã phát hành ${status.results.length} thẻ.`,
        'success',
      )
      void invalidateMoneyQueries(queryClient)
    }
  }, [clearKey, queryClient, statusQuery.data])

  const clearCompletedSale = () => {
    setResults([])
    setCart([])
  }

  return (
    <section className="checkout-panel combo-pos" aria-labelledby="combo-sale-title">
      <div className="checkout-panel__header">
        <div>
          <h2 id="combo-sale-title">Bán COMBO trực tiếp</h2>
          <p>Chọn COMBO để thêm vào phiếu bán · giá được máy chủ xác nhận khi chốt</p>
        </div>
        <StatusBadge tone="info">Giá do máy chủ quyết định</StatusBadge>
      </div>

      {comboQuery.isLoading ? (
        <StateView title="Đang tải danh mục COMBO…" />
      ) : comboQuery.isError ? (
        <StateView
          title="Không tải được COMBO"
          description={(comboQuery.error as Error).message}
          action={<Button onClick={() => void comboQuery.refetch()}>Thử lại</Button>}
        />
      ) : catalog.length === 0 ? (
        <StateView title="Chưa có COMBO đang hoạt động" />
      ) : (
        <div className={`combo-pos__layout ${cart.length ? 'has-context' : ''}`}>
          <div className="combo-pos__catalog-area">
            <div className="combo-zone-filter" role="group" aria-label="Lọc COMBO theo nhóm máy">
              <button
                type="button"
                className={machineGroupFilter === null ? 'is-active' : ''}
                aria-pressed={machineGroupFilter === null}
                onClick={() => setMachineGroupFilter(null)}
              >
                Tất cả
              </button>
              {machineGroups.map((group) => (
                <button
                  type="button"
                  key={group.id}
                  className={machineGroupFilter === group.id ? 'is-active' : ''}
                  aria-pressed={machineGroupFilter === group.id}
                  onClick={() => setMachineGroupFilter(group.id)}
                >
                  {group.name}
                </button>
              ))}
            </div>
            <div className="combo-pos__catalog">
            {visibleCatalog.map((combo) => {
              const selected = cartIds.has(combo.comboId)
              const usage = comboUsagePresentation(combo, machineGroupFilter, serverNowMs)
              return (
                <article
                  className={`combo-product-card${selected ? ' is-selected' : ''}${
                    !combo.salableNow ? ' is-unavailable' : ''
                  }`}
                  key={combo.comboId}
                >
                  <div className="combo-product-card__eyebrow">
                    <span className="combo-product-card__name">{combo.name}</span>
                    <span title="Trạng thái sử dụng do máy chủ tính theo từng nhóm máy.">
                      <StatusBadge
                        tone={!combo.salableNow ? 'warning' : usage?.usableNow ? 'success' : 'info'}
                      >
                        {!combo.salableNow ? 'Ngoài giờ bán' : usage?.label ?? 'Có thể bán'}
                      </StatusBadge>
                    </span>
                  </div>
                  <div className="combo-product-card__headline">
                    <div className="combo-product-card__time">
                      <span><CalendarBlank size={20} weight="bold" />{formatWeekdays(combo.weekday)}</span>
                      <span><Clock size={20} weight="bold" />{formatUsageTime(combo)}</span>
                    </div>
                    <b className="combo-product-card__duration">{combo.type === 2 ? formatDuration(combo.duration) : 'Giờ cố định'}</b>
                  </div>
                  <div className="combo-product-card__zones">
                    <i aria-hidden="true">
                      <MapPin size={16} weight="bold" />
                    </i>
                    <div>
                      {combo.machineGroups.map((group) => (
                        <span key={group.machineGroupId}>{group.name}</span>
                      ))}
                    </div>
                  </div>
                  <div className="combo-product-card__donates">
                    <i aria-hidden="true"><BowlFood size={16} weight="bold" /></i>
                    <span>
                      {combo.donates.length
                        ? combo.donates
                            .map((item) => `${item.quantity} ${item.name}${item.unit ? ` ${item.unit}` : ''}`)
                            .join(' · ')
                        : combo.include || 'Không kèm dịch vụ'}
                    </span>
                  </div>
                  <strong className="combo-product-card__price">{formatMoney(combo.price)}</strong>
                  <button
                    type="button"
                    className={`combo-product-card__sell${selected ? ' is-selected' : ''}`}
                    disabled={selected || !combo.salableNow}
                    onClick={() => selectCombo(combo)}
                  >
                    {selected ? '✓ ĐÃ CHỌN' : 'BÁN'}
                  </button>
                </article>
              )
            })}
            </div>
          </div>

          {cart.length ? (
            <aside className="combo-context" aria-label="Phiếu bán COMBO">
              <header>
                <div>
                  <span>Phiếu bán</span>
                  <h3>COMBO đã chọn</h3>
                </div>
                <StatusBadge tone="info">{totalQuantity} thẻ</StatusBadge>
              </header>

              <div className="combo-context__lines">
                {cart.map((line) => (
                  <article key={line.combo.comboId}>
                    <div className="combo-context__line-title">
                      <div>
                        <strong>{line.combo.name}</strong>
                        <span>{formatMoney(line.combo.price)} / thẻ</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Bỏ ${line.combo.name}`}
                        onClick={() => changeQuantity(line.combo.comboId, 0)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="combo-context__line-bottom">
                      <div className="combo-quantity" aria-label={`Số lượng ${line.combo.name}`}>
                        <button
                          type="button"
                          aria-label="Giảm số lượng"
                          onClick={() => changeQuantity(line.combo.comboId, line.quantity - 1)}
                        >
                          −
                        </button>
                        <input
                          aria-label="Số lượng"
                          type="number"
                          min="1"
                          max="99"
                          value={line.quantity}
                          onChange={(event) =>
                            changeQuantity(line.combo.comboId, Number(event.target.value))
                          }
                        />
                        <button
                          type="button"
                          aria-label="Tăng số lượng"
                          disabled={line.quantity >= 99}
                          onClick={() => changeQuantity(line.combo.comboId, line.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <strong>{formatMoney(line.combo.price * line.quantity)}</strong>
                    </div>
                  </article>
                ))}
              </div>

              <div className="combo-context__checkout">
                <fieldset>
                  <legend>Phương thức thanh toán</legend>
                  {(
                    [
                      ['cash', 'Tiền mặt'],
                      ['online', 'Online đã xác nhận'],
                      ['qr', 'QR tại quầy'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="combo-payment"
                        value={value}
                        checked={method === value}
                        onChange={() => setMethod(value)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <dl>
                  <div><dt>Số loại</dt><dd>{cart.length}</dd></div>
                  <div><dt>Số thẻ</dt><dd>{totalQuantity}</dd></div>
                  <div className="combo-context__total"><dt>Tổng thanh toán</dt><dd>{formatMoney(total)}</dd></div>
                </dl>
                <Button
                  variant="primary"
                  block
                  loading={saleMutation.isPending}
                  disabled={!cart.length || cart.some((line) => line.quantity < 1 || line.quantity > 99)}
                  onClick={() => saleMutation.mutate()}
                >
                  {method === 'qr' ? 'Tạo mã QR và xác nhận' : 'Xác nhận bán COMBO'}
                </Button>
                <button type="button" className="combo-context__clear" onClick={() => setCart([])}>
                  Bỏ toàn bộ lựa chọn
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      )}

      <Dialog
        open={Boolean(qr)}
        title="Quét QR thanh toán COMBO"
        description="Không đóng hoặc tạo giao dịch khác khi máy chủ đang xác nhận."
        onClose={() => {
          if (['error', 'failed', 'expired'].includes(statusQuery.data?.state ?? '')) {
            clearKey()
            setQr(null)
          }
        }}
        footer={
          ['error', 'failed', 'expired'].includes(statusQuery.data?.state ?? '') ? (
            <Button onClick={() => { clearKey(); setQr(null) }}>Đóng</Button>
          ) : (
            <Button disabled>Đang chờ thanh toán…</Button>
          )
        }
      >
        {qr ? (
          <div className="combo-qr">
            <img src={qr.img} alt="Mã QR thanh toán COMBO" />
            <strong>{formatMoney(qr.value)}</strong>
            <span>{qr.bank} · {qr.account}</span>
            <b>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</b>
            {['error', 'failed', 'expired'].includes(statusQuery.data?.state ?? '') ? (
              <InlineAlert tone="danger">
                {statusQuery.data?.state === 'error'
                  ? 'Cổng thanh toán đã xác nhận nhưng ghi thẻ thất bại. Không bán lại; cần đối soát vận hành.'
                  : statusQuery.data?.state === 'failed'
                    ? 'Thanh toán không thành công.'
                    : 'Mã QR đã hết hạn.'}
              </InlineAlert>
            ) : null}
            {statusQuery.isError ? (
              <InlineAlert tone="warning">
                Mất kết nối đọc trạng thái; hệ thống sẽ tiếp tục thử với cùng mã giao dịch.
              </InlineAlert>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={results.length > 0}
        title="Thẻ COMBO đã phát hành"
        description="Mật khẩu chỉ được máy chủ trả về lần này. Hãy in hoặc bàn giao trước khi đóng."
        size="lg"
        onClose={clearCompletedSale}
        footer={
          <>
            <Button onClick={() => window.print()}>In thẻ</Button>
            <Button variant="primary" onClick={clearCompletedSale}>Đã bàn giao</Button>
          </>
        }
      >
        <div className="combo-credentials">
          {results.map((result) => (
            <article key={result.comboDetailId}>
              <span>Thẻ #{result.comboDetailId}</span>
              <dl>
                <div><dt>Tài khoản</dt><dd>{result.username}</dd></div>
                <div><dt>Mật khẩu</dt><dd>{result.password}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <InlineAlert tone="warning">
          Sau khi đóng, WebUI không thể đọc lại mật khẩu từ máy chủ.
        </InlineAlert>
      </Dialog>
    </section>
  )
}
