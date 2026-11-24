import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, ClockCountdown, Desktop, Money, Plus, Trash } from '@phosphor-icons/react'
import type { MachineGroup } from '../../api/machine-groups'
import { getPromotionDiscount, getPromotionTime, savePromotionTime, type PromotionTime } from '../../api/promotion'
import { Button, ConfirmAction, IconButton, InlineAlert, MoneyInput, Select, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { PeriodCard, RuleField, RuleLabel, SaveBar } from './PromotionParts'
import {
  ALL_DAYS,
  DAY_PRESETS,
  HOURS_FROM,
  WEEKDAYS,
  defaultPeriod,
  describeDays,
  findTimeOverlaps,
  formatHour,
  hoursTo,
  normalizeHour,
  periodForSave,
  toggleDay,
  validatePeriod,
  validateTimeRules,
  type TimeRule,
  nextUid,
  today,
} from './promotionModel'

type Props = {
  priceId: number
  /** Nhóm khách vãng lai: máy chủ xóa TOÀN BỘ cấu hình giá/khuyến mãi khác của nhóm khi lưu khung giờ (parity MFC). */
  isAnonymous: boolean
  machineGroups: MachineGroup[]
  canSave: boolean
  onDirtyChange: (dirty: boolean) => void
}

/** Khung giờ vàng = giá riêng theo giờ trong ngày và ngày trong tuần, cho từng nhóm máy. */
export function TimePanel(props: Props) {
  const { priceId } = props
  const query = useQuery({ queryKey: ['promotions', 'time', priceId], queryFn: () => getPromotionTime(priceId) })

  if (query.isLoading) return <StateView title="Đang tải khung giờ vàng…" />
  if (query.isError || !query.data) {
    return (
      <StateView
        title="Không tải được khung giờ vàng"
        description={query.error instanceof Error ? query.error.message : undefined}
        action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
      />
    )
  }
  return <TimeForm key={`${priceId}:${query.dataUpdatedAt}`} {...props} data={query.data} />
}

function rulesFrom(data: PromotionTime) {
  let fixed = 0
  const rules: TimeRule[] = data.rows.map((row) => {
    const begin = normalizeHour(row.beginTime, 0)
    const end = normalizeHour(row.endTime, 24)
    if (begin.fixed || end.fixed) fixed += 1
    const beginHour = Math.min(begin.hour, 23)
    return {
      uid: nextUid(),
      machineGroupId: row.machineGroupId,
      beginHour,
      endHour: Math.max(end.hour, beginHour + 1),
      price: row.price,
      dayMask: row.dayOfWeekMask,
    }
  })
  return { rules, fixed }
}

function snapshot(rules: TimeRule[], begin: string, end: string) {
  return JSON.stringify({ rules: rules.map(({ uid: _uid, ...rest }) => rest), begin, end })
}

function TimeForm({ priceId, isAnonymous, machineGroups, canSave, onDirtyChange, data }: Props & { data: PromotionTime }) {
  const queryClient = useQueryClient()
  const [initial] = useState(() => {
    const { rules, fixed } = rulesFrom(data)
    const first = data.rows[0]
    const period = first?.beginDate && first?.endDate ? { begin: first.beginDate, end: first.endDate } : defaultPeriod(today())
    return { rules, fixed, begin: period.begin, end: period.end }
  })
  const [rules, setRules] = useState<TimeRule[]>(initial.rules)
  const [begin, setBegin] = useState(initial.begin)
  const [end, setEnd] = useState(initial.end)
  const [baseline] = useState(() => snapshot(initial.rules, initial.begin, initial.end))
  const [confirmWipe, setConfirmWipe] = useState(false)

  // Nhóm vãng lai: lưu khung giờ xóa luôn các dòng giảm giá theo giờ chơi ⇒ cần biết có bao nhiêu dòng sắp mất.
  const discountQuery = useQuery({
    queryKey: ['promotions', 'discount', priceId],
    queryFn: () => getPromotionDiscount(priceId),
    enabled: isAnonymous,
  })
  const discountCount = isAnonymous ? (discountQuery.data?.rows.length ?? 0) : 0

  const dirty = snapshot(rules, begin, end) !== baseline
  const overlaps = findTimeOverlaps(rules)
  const overlapping = new Set(overlaps.flat())
  const error = validateTimeRules(rules) ?? (rules.length > 0 ? validatePeriod(begin, end, today()) : null)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  const mutation = useMutation({
    mutationFn: () => {
      const period = periodForSave(begin, end, rules.length > 0, today())
      return savePromotionTime({
        priceId,
        beginDate: period.begin,
        endDate: period.end,
        rows: rules.map((rule) => ({
          machineGroupId: rule.machineGroupId,
          beginTime: rule.beginHour,
          endTime: rule.endHour,
          price: rule.price ?? 0,
          dayOfWeekMask: rule.dayMask,
        })),
      })
    },
    onSuccess: () => {
      setConfirmWipe(false)
      pushToast('Đã lưu khung giờ vàng.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['promotions'] })
    },
    onError: (err: Error) => {
      setConfirmWipe(false)
      pushToast(err.message || 'Không lưu được', 'error')
    },
  })

  const disabled = !canSave || mutation.isPending
  const update = (uid: string, patch: Partial<TimeRule>) =>
    setRules((current) => current.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)))
  const addRule = () =>
    setRules((current) => [
      ...current,
      {
        uid: nextUid(),
        machineGroupId: machineGroups.length === 1 ? machineGroups[0].id : 0,
        beginHour: 0,
        endHour: 24,
        price: null,
        dayMask: ALL_DAYS,
      },
    ])

  const requestSave = () => {
    if (isAnonymous && discountCount > 0) setConfirmWipe(true)
    else mutation.mutate()
  }

  return (
    <div className="promo-panel">
      <p className="promo-lead">
        Đặt giá riêng theo giờ trong ngày cho từng nhóm máy, ví dụ giá rẻ ban đêm hoặc giá cao giờ cao điểm. Trong khung giờ này,
        giá khung giờ thay cho giá thường của nhóm máy.
      </p>

      {initial.fixed > 0 ? (
        <InlineAlert tone="warning">
          {initial.fixed} khung giờ đang lưu với giờ không hợp lệ (bản web cũ lưu sai định dạng) nên đã được quy về giờ tròn gần nhất.
          Hãy kiểm tra lại rồi bấm Lưu.
        </InlineAlert>
      ) : null}

      {isAnonymous ? (
        <InlineAlert tone="warning">
          Với nhóm khách vãng lai, lưu khung giờ vàng sẽ thay thế toàn bộ cấu hình giá khuyến mãi khác của nhóm này
          (giống form MFC)
          {discountCount > 0 ? `, gồm ${discountCount} dòng “Giảm giá theo giờ chơi” đang có` : ''}.
        </InlineAlert>
      ) : null}

      {machineGroups.length === 0 ? (
        <InlineAlert tone="danger">Chưa có nhóm máy nào. Hãy tạo nhóm máy trước khi đặt khung giờ vàng.</InlineAlert>
      ) : null}

      <PeriodCard begin={begin} end={end} onBegin={setBegin} onEnd={setEnd} disabled={disabled} />

      <section className="promo-card" aria-labelledby="promo-time-title">
        <header>
          <h3 id="promo-time-title">Khung giờ và giá</h3>
          <p>Mỗi khung gồm nhóm máy, giờ bắt đầu – kết thúc, giá một giờ và các ngày áp dụng.</p>
        </header>

        {overlaps.length > 0 ? (
          <InlineAlert tone="warning">
            Có khung giờ chồng nhau (cùng nhóm máy, cùng ngày, trùng giờ) — được đánh dấu bên dưới. Mỗi thời điểm chỉ lấy một giá,
            hãy sửa để các khung không giao nhau.
          </InlineAlert>
        ) : null}

        {rules.length === 0 ? (
          <p className="promo-empty">Chưa có khung giờ vàng nào. Bấm “Thêm khung giờ” để tạo.</p>
        ) : (
          <ol className="promo-rules">
            {rules.map((rule, index) => (
              <li key={rule.uid} className={`promo-rule${overlapping.has(index) ? ' is-overlap' : ''}`}>
                <div className="promo-rule__fields">
                  <RuleField label="Nhóm máy" icon={<Desktop size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.machineGroupId}
                      disabled={disabled}
                      aria-label={`Khung giờ ${index + 1} — nhóm máy`}
                      onChange={(event) => update(rule.uid, { machineGroupId: Number(event.target.value) })}
                    >
                      <option value={0}>Chọn nhóm máy</option>
                      {machineGroups.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </Select>
                  </RuleField>
                  <RuleField label="Từ giờ" icon={<Clock size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.beginHour}
                      disabled={disabled}
                      aria-label={`Khung giờ ${index + 1} — từ giờ`}
                      onChange={(event) => {
                        const beginHour = Number(event.target.value)
                        update(rule.uid, { beginHour, endHour: Math.max(rule.endHour, beginHour + 1) })
                      }}
                    >
                      {HOURS_FROM.map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}
                    </Select>
                  </RuleField>
                  <RuleField label="Đến giờ" icon={<ClockCountdown size={18} weight="bold" aria-hidden="true" />}>
                    <Select
                      className="ds-select"
                      value={rule.endHour}
                      disabled={disabled}
                      aria-label={`Khung giờ ${index + 1} — đến giờ`}
                      onChange={(event) => update(rule.uid, { endHour: Number(event.target.value) })}
                    >
                      {hoursTo(rule.beginHour).map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}
                    </Select>
                  </RuleField>
                  <MoneyInput
                    label="Giá một giờ"
                    icon={<RuleLabel icon={<Money size={18} weight="bold" aria-hidden="true" />} text="Giá một giờ" />}
                    placeholder="Giá một giờ"
                    currency="đ/giờ"
                    value={rule.price}
                    disabled={disabled}
                    max={999_999}
                    onChange={(value) => update(rule.uid, { price: value })}
                  />
                  <IconButton
                    label={`Xóa khung giờ ${index + 1}`}
                    icon={<Trash size={18} weight="bold" />}
                    className="promo-delete"
                    disabled={disabled}
                    onClick={() => setRules((current) => current.filter((item) => item.uid !== rule.uid))}
                  />
                </div>

                <div className="promo-rule__days">
                  <span className="promo-rule__days-label">Ngày áp dụng</span>
                  <div className="promo-days" role="group" aria-label={`Khung giờ ${index + 1} — ngày trong tuần`}>
                    {WEEKDAYS.map((day) => {
                      const on = (rule.dayMask & day.bit) !== 0
                      return (
                        <button
                          key={day.bit}
                          type="button"
                          className={`promo-day${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          title={day.long}
                          disabled={disabled}
                          onClick={() => update(rule.uid, { dayMask: toggleDay(rule.dayMask, day.bit) })}
                        >
                          {day.short}
                        </button>
                      )
                    })}
                  </div>
                  <div className="promo-presets">
                    {DAY_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        className="promo-preset"
                        disabled={disabled}
                        onClick={() => update(rule.uid, { dayMask: preset.mask })}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <span className="promo-rule__summary">
                    {describeDays(rule.dayMask)} · {formatHour(rule.beginHour)} – {formatHour(rule.endHour)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div>
          <Button type="button" variant="secondary" disabled={disabled || machineGroups.length === 0} onClick={addRule}>
            <Plus size={16} weight="bold" aria-hidden="true" /> Thêm khung giờ
          </Button>
        </div>
      </section>

      <SaveBar
        dirty={dirty}
        pending={mutation.isPending}
        error={error}
        canSave={canSave}
        noRightHint="Cần quyền Khuyến mãi (54)."
        saveLabel="Lưu khung giờ vàng"
        onSave={requestSave}
        onReset={() => {
          setRules(initial.rules)
          setBegin(initial.begin)
          setEnd(initial.end)
        }}
      />

      <ConfirmAction
        open={confirmWipe}
        danger
        title="Lưu khung giờ vàng?"
        description={`${discountCount} dòng “Giảm giá theo giờ chơi” của nhóm này sẽ bị xóa.`}
        confirmLabel="Lưu và xóa các dòng đó"
        pending={mutation.isPending}
        onCancel={() => setConfirmWipe(false)}
        onConfirm={() => mutation.mutate()}
      >
        <InlineAlert tone="warning">
          Máy chủ thay thế toàn bộ cấu hình khuyến mãi của nhóm khách vãng lai khi lưu khung giờ (giống form MFC). Nếu cần giữ,
          hãy nhập lại “Giảm giá theo giờ chơi” sau khi lưu.
        </InlineAlert>
      </ConfirmAction>
    </div>
  )
}
