import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Desktop, ListNumbers, Money, Plus, Timer, Trash } from '@phosphor-icons/react'
import type { MachineGroup } from '../../api/machine-groups'
import { getPromotionDiscount, savePromotionDiscount, type PromotionDiscount } from '../../api/promotion'
import { Button, IconButton, InlineAlert, InlineField, InlineFieldLabel, MoneyInput, Select, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { PeriodCard, SaveBar } from './PromotionParts'
import {
  DISCOUNT_HOURS,
  defaultPeriod,
  periodForSave,
  validateDiscountRules,
  validatePeriod,
  type DiscountOrder,
  type DiscountRule,
  nextUid,
  today,
} from './promotionModel'

type Props = { priceId: number; machineGroups: MachineGroup[]; canSave: boolean; onDirtyChange: (dirty: boolean) => void }

/** Giảm giá theo thời gian sử dụng: các đợt giờ chơi ("Bắt đầu", "Tiếp theo") với giá riêng — như form MFC cùng tên. */
export function DiscountPanel(props: Props) {
  const { priceId } = props
  const query = useQuery({ queryKey: ['promotions', 'discount', priceId], queryFn: () => getPromotionDiscount(priceId) })

  if (query.isLoading) return <StateView title="Đang tải giảm giá theo giờ chơi…" />
  if (query.isError || !query.data) {
    return (
      <StateView
        title="Không tải được giảm giá theo giờ chơi"
        description={query.error instanceof Error ? query.error.message : undefined}
        action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
      />
    )
  }
  return <DiscountForm key={`${priceId}:${query.dataUpdatedAt}`} {...props} data={query.data} />
}

function snapshot(rules: DiscountRule[], begin: string, end: string) {
  return JSON.stringify({ rules: rules.map(({ uid: _uid, ...rest }) => rest), begin, end })
}

function DiscountForm({ priceId, machineGroups, canSave, onDirtyChange, data }: Props & { data: PromotionDiscount }) {
  const queryClient = useQueryClient()
  const [initial] = useState(() => {
    const rules: DiscountRule[] = data.rows.map((row) => ({
      uid: nextUid(),
      machineGroupId: row.machineGroupId,
      order: (row.promotionOrder === 1 ? 1 : 0) as DiscountOrder,
      hours: row.term,
      price: row.price,
    }))
    const first = data.rows[0]
    const period = first?.beginDate && first?.endDate ? { begin: first.beginDate, end: first.endDate } : defaultPeriod(today())
    return { rules, begin: period.begin, end: period.end }
  })
  const [rules, setRules] = useState<DiscountRule[]>(initial.rules)
  const [begin, setBegin] = useState(initial.begin)
  const [end, setEnd] = useState(initial.end)
  const [baseline] = useState(() => snapshot(initial.rules, initial.begin, initial.end))

  const dirty = snapshot(rules, begin, end) !== baseline
  const error = validateDiscountRules(rules) ?? (rules.length > 0 ? validatePeriod(begin, end, today()) : null)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  const mutation = useMutation({
    mutationFn: () => {
      const period = periodForSave(begin, end, rules.length > 0, today())
      return savePromotionDiscount({
        priceId,
        beginDate: period.begin,
        endDate: period.end,
        rows: rules.map((rule) => ({
          machineGroupId: rule.machineGroupId,
          promotionOrder: rule.order,
          term: rule.hours,
          price: rule.price ?? 0,
        })),
      })
    },
    onSuccess: () => {
      pushToast('Đã lưu giảm giá theo giờ chơi.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['promotions'] })
    },
    onError: (err: Error) => pushToast(err.message || 'Không lưu được', 'error'),
  })

  const disabled = !canSave || mutation.isPending
  const update = (uid: string, patch: Partial<DiscountRule>) =>
    setRules((current) => current.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)))
  const addRule = () =>
    setRules((current) => [
      ...current,
      {
        uid: nextUid(),
        machineGroupId: machineGroups.length === 1 ? machineGroups[0].id : 0,
        order: current.some((rule) => rule.order === 0) ? 1 : 0,
        hours: 1,
        price: null,
      },
    ])

  return (
    <div className="promo-panel">
      <p className="promo-lead">
        Đặt giá theo thời gian khách đã chơi, giống form MFC “Giảm giá theo thời gian sử dụng”: đợt <strong>Bắt đầu</strong> là
        những giờ chơi đầu tiên, các đợt <strong>Tiếp theo</strong> là những giờ kế tiếp. Mỗi dòng: “với N giờ thì giá là bao nhiêu”.
      </p>

      {machineGroups.length === 0 ? (
        <InlineAlert tone="danger">Chưa có nhóm máy nào. Hãy tạo nhóm máy trước khi đặt giảm giá.</InlineAlert>
      ) : null}

      <PeriodCard begin={begin} end={end} onBegin={setBegin} onEnd={setEnd} disabled={disabled} />

      <section className="promo-card" aria-labelledby="promo-discount-title">
        <header>
          <h3 id="promo-discount-title">Các đợt giờ chơi và giá</h3>
          <p>Thêm một dòng cho mỗi đợt, theo từng nhóm máy.</p>
        </header>

        {rules.length === 0 ? (
          <p className="promo-empty">Chưa có dòng giảm giá nào. Bấm “Thêm dòng” để tạo.</p>
        ) : (
          <ol className="promo-rules">
            {rules.map((rule, index) => (
              <li key={rule.uid} className="promo-rule">
                <div className="promo-rule__fields promo-rule__fields--discount">
                  <InlineField label="Nhóm máy" icon={<Desktop size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.machineGroupId}
                      disabled={disabled}
                      aria-label={`Dòng ${index + 1} — nhóm máy`}
                      onChange={(event) => update(rule.uid, { machineGroupId: Number(event.target.value) })}
                    >
                      <option value={0}>Chọn nhóm máy</option>
                      {machineGroups.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </Select>
                  </InlineField>
                  <InlineField label="Đợt" icon={<ListNumbers size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.order}
                      disabled={disabled}
                      aria-label={`Dòng ${index + 1} — đợt`}
                      onChange={(event) => update(rule.uid, { order: Number(event.target.value) === 1 ? 1 : 0 })}
                    >
                      <option value={0}>Bắt đầu</option>
                      <option value={1}>Tiếp theo</option>
                    </Select>
                  </InlineField>
                  <InlineField label="Số giờ" icon={<Timer size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.hours}
                      disabled={disabled}
                      aria-label={`Dòng ${index + 1} — số giờ`}
                      onChange={(event) => update(rule.uid, { hours: Number(event.target.value) })}
                    >
                      {DISCOUNT_HOURS.map((hour) => <option key={hour} value={hour}>{hour} giờ</option>)}
                    </Select>
                  </InlineField>
                  <MoneyInput
                    label="Giá"
                    icon={<InlineFieldLabel icon={<Money size={18} weight="bold" aria-hidden="true" />} text="Giá" />}
                    placeholder="Giá"
                    value={rule.price}
                    disabled={disabled}
                    max={999_999}
                    onChange={(value) => update(rule.uid, { price: value })}
                  />
                  <IconButton
                    label={`Xóa dòng ${index + 1}`}
                    icon={<Trash size={18} weight="bold" />}
                    className="promo-delete"
                    disabled={disabled}
                    onClick={() => setRules((current) => current.filter((item) => item.uid !== rule.uid))}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}

        <div>
          <Button type="button" variant="secondary" disabled={disabled || machineGroups.length === 0} onClick={addRule}>
            <Plus size={16} weight="bold" aria-hidden="true" /> Thêm dòng
          </Button>
        </div>
      </section>

      <SaveBar
        dirty={dirty}
        pending={mutation.isPending}
        error={error}
        canSave={canSave}
        noRightHint="Cần quyền Khuyến mãi (54)."
        saveLabel="Lưu giảm giá"
        onSave={() => mutation.mutate()}
        onReset={() => {
          setRules(initial.rules)
          setBegin(initial.begin)
          setEnd(initial.end)
        }}
      />
    </div>
  )
}
