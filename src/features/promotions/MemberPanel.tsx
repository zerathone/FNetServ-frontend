import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, Percent, Plus, Trash, Wallet } from '@phosphor-icons/react'
import { getPromotionMember, savePromotionMember, type PromotionMember } from '../../api/promotion'
import { Button, IconButton, InlineFieldLabel, MoneyInput, RadioCards, StateView, StatusBadge } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { PeriodCard, SaveBar } from './PromotionParts'
import {
  MEMBER_POLICY_OPTIONS,
  defaultPeriod,
  memberHasContent,
  periodForSave,
  validateMemberDraft,
  validatePeriod,
  type MemberDraft,
  type MemberPolicyKind,
  type TierRow,
  nextUid,
  today,
} from './promotionModel'

/** Nạp tiền: chỉ hội viên có. Tải dữ liệu rồi dựng form theo dữ liệu đó (key đổi khi tải lại => form dựng lại, hết "chưa lưu"). */
export function MemberPanel({ priceId, canSave, onDirtyChange }: { priceId: number; canSave: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const query = useQuery({ queryKey: ['promotions', 'member', priceId], queryFn: () => getPromotionMember(priceId) })

  if (query.isLoading) return <StateView title="Đang tải khuyến mãi nạp tiền…" />
  if (query.isError || !query.data) {
    return (
      <StateView
        title="Không tải được khuyến mãi nạp tiền"
        description={query.error instanceof Error ? query.error.message : undefined}
        action={<Button onClick={() => void query.refetch()}>Thử lại</Button>}
      />
    )
  }
  return <MemberForm key={`${priceId}:${query.dataUpdatedAt}`} priceId={priceId} data={query.data} canSave={canSave} onDirtyChange={onDirtyChange} />
}

function draftFrom(data: PromotionMember): MemberDraft {
  const policy: MemberPolicyKind = data.accumulate
    ? 'accumulate'
    : data.freeTiers.length > 0
      ? 'free'
      : data.percentTiers.length > 0
        ? 'percent'
        : 'none'
  return {
    policy,
    accumulate: { charge: data.accumulate?.charge ?? null, bonus: data.accumulate?.bonus ?? null },
    freeTiers: data.freeTiers.map((tier) => ({ uid: nextUid(), charge: tier.charge, value: tier.free })),
    percentTiers: data.percentTiers.map((tier) => ({ uid: nextUid(), charge: tier.charge, value: tier.percent })),
    firstDeposit: { percent: data.firstDeposit?.percent ?? null, minAmount: data.firstDeposit?.minAmount ?? null },
  }
}

function periodFrom(data: PromotionMember) {
  const saved = data.period ?? data.accumulate ?? data.firstDeposit
  if (saved?.beginDate && saved?.endDate) return { begin: saved.beginDate, end: saved.endDate }
  const fallback = defaultPeriod(today())
  return { begin: fallback.begin, end: fallback.end }
}

/** Bản chụp so sánh "có thay đổi chưa lưu" — bỏ khóa dòng (uid) vì chỉ phục vụ giao diện. */
function snapshot(draft: MemberDraft, begin: string, end: string) {
  const strip = (tiers: TierRow[]) => tiers.map(({ charge, value }) => ({ charge, value }))
  return JSON.stringify({ ...draft, freeTiers: strip(draft.freeTiers), percentTiers: strip(draft.percentTiers), begin, end })
}

function MemberForm({ priceId, data, canSave, onDirtyChange }: { priceId: number; data: PromotionMember; canSave: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient()
  const [initial] = useState(() => ({ draft: draftFrom(data), period: periodFrom(data) }))
  const [draft, setDraft] = useState<MemberDraft>(initial.draft)
  const [begin, setBegin] = useState(initial.period.begin)
  const [end, setEnd] = useState(initial.period.end)
  const [baseline] = useState(() => snapshot(initial.draft, initial.period.begin, initial.period.end))

  const hasContent = memberHasContent(draft)
  const dirty = snapshot(draft, begin, end) !== baseline
  const error = validateMemberDraft(draft) ?? (hasContent ? validatePeriod(begin, end, today()) : null)

  // Báo lên trang để cảnh báo khi đổi nhóm lúc còn thay đổi chưa lưu.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  const mutation = useMutation({
    mutationFn: () => {
      const period = periodForSave(begin, end, hasContent, today())
      const toBody = (tiers: TierRow[], key: 'free' | 'percent') =>
        tiers.map((tier) => ({ charge: tier.charge ?? 0, [key]: tier.value ?? 0 }))
      return savePromotionMember({
        priceId,
        apply: true,
        policy: draft.policy,
        beginDate: period.begin,
        endDate: period.end,
        charge: draft.accumulate.charge ?? 0,
        bonus: draft.accumulate.bonus ?? 0,
        freeTiers: toBody(draft.freeTiers, 'free') as Array<{ charge: number; free: number }>,
        percentTiers: toBody(draft.percentTiers, 'percent') as Array<{ charge: number; percent: number }>,
        firstDeposit: { percent: draft.firstDeposit.percent ?? 0, minAmount: draft.firstDeposit.minAmount ?? 0 },
      })
    },
    onSuccess: () => {
      pushToast('Đã lưu khuyến mãi nạp tiền.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['promotions'] })
    },
    onError: (err: Error) =>
      pushToast(/FN5/.test(err.message) ? 'Khuyến mãi nạp lần đầu cần license FN5.' : err.message || 'Không lưu được', 'error'),
  })

  const disabled = !canSave || mutation.isPending
  const setPolicy = (policy: MemberPolicyKind) => setDraft((current) => ({ ...current, policy }))

  return (
    <div className="promo-panel">
      <PeriodCard
        begin={begin}
        end={end}
        onBegin={setBegin}
        onEnd={setEnd}
        disabled={disabled}
        hint="Áp dụng cho chính sách nạp tiền và nạp lần đầu bên dưới."
      />

      <section className="promo-card" aria-labelledby="promo-policy-title">
        <header>
          <h3 id="promo-policy-title">Chính sách nạp tiền</h3>
          <p>Chọn một cách tặng thêm khi hội viên nạp tiền.</p>
        </header>
        <RadioCards<MemberPolicyKind>
          ariaLabel="Chính sách nạp tiền"
          value={draft.policy}
          disabled={disabled}
          options={MEMBER_POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label, description: option.hint }))}
          onChange={setPolicy}
        />

        {draft.policy === 'accumulate' ? (
          <div className="promo-fields">
            <MoneyInput
              label="Số tiền tích lũy"
              value={draft.accumulate.charge}
              disabled={disabled}
              max={999_999_999}
              hint="Hội viên nạp tích lũy đủ số này sẽ được tặng."
              onChange={(value) => setDraft((current) => ({ ...current, accumulate: { ...current.accumulate, charge: value } }))}
            />
            <MoneyInput
              label="Số tiền được tặng"
              value={draft.accumulate.bonus}
              disabled={disabled}
              max={999_999_999}
              hint="Không lớn hơn số tiền tích lũy."
              onChange={(value) => setDraft((current) => ({ ...current, accumulate: { ...current.accumulate, bonus: value } }))}
            />
          </div>
        ) : null}

        {draft.policy === 'free' ? (
          <TierEditor
            kind="free"
            tiers={draft.freeTiers}
            disabled={disabled}
            onChange={(freeTiers) => setDraft((current) => ({ ...current, freeTiers }))}
          />
        ) : null}

        {draft.policy === 'percent' ? (
          <TierEditor
            kind="percent"
            tiers={draft.percentTiers}
            disabled={disabled}
            onChange={(percentTiers) => setDraft((current) => ({ ...current, percentTiers }))}
          />
        ) : null}
      </section>

      <section className="promo-card" aria-labelledby="promo-first-title">
        <header>
          <h3 id="promo-first-title">
            Nạp lần đầu <StatusBadge tone="neutral" dot={false}>Độc lập</StatusBadge>
          </h3>
          <p>Tặng thêm cho lần nạp đầu tiên của hội viên mới, cộng cùng chính sách ở trên. Để trống hoặc 0 = không áp dụng. Cần license FN5.</p>
        </header>
        <div className="promo-fields">
          <MoneyInput
            label="Nạp tối thiểu"
            value={draft.firstDeposit.minAmount}
            disabled={disabled}
            max={999_999_999}
            hint="Lần nạp đầu từ số này trở lên mới được tặng."
            onChange={(value) => setDraft((current) => ({ ...current, firstDeposit: { ...current.firstDeposit, minAmount: value } }))}
          />
          <MoneyInput
            label="Tặng thêm"
            currency="%"
            value={draft.firstDeposit.percent}
            disabled={disabled}
            max={100}
            hint="Phần trăm trên số tiền nạp (1–100)."
            onChange={(value) => setDraft((current) => ({ ...current, firstDeposit: { ...current.firstDeposit, percent: value } }))}
          />
        </div>
      </section>

      <SaveBar
        dirty={dirty}
        pending={mutation.isPending}
        error={error}
        canSave={canSave}
        noRightHint="Cần quyền Khuyến mãi (54)."
        saveLabel="Lưu khuyến mãi nạp tiền"
        onSave={() => mutation.mutate()}
        onReset={() => {
          setDraft(initial.draft)
          setBegin(initial.period.begin)
          setEnd(initial.period.end)
        }}
      />
    </div>
  )
}

function TierEditor({
  kind,
  tiers,
  disabled,
  onChange,
}: {
  kind: 'free' | 'percent'
  tiers: TierRow[]
  disabled: boolean
  onChange: (tiers: TierRow[]) => void
}) {
  const valueLabel = kind === 'free' ? 'Tặng thêm' : 'Tặng thêm (%)'
  const update = (uid: string, patch: Partial<TierRow>) =>
    onChange(tiers.map((tier) => (tier.uid === uid ? { ...tier, ...patch } : tier)))

  return (
    <div className="promo-tiers">
      {tiers.length === 0 ? (
        <p className="promo-empty">Chưa có mốc nào. Bấm “Thêm mốc” để tạo mốc đầu tiên.</p>
      ) : (
        tiers.map((tier, index) => (
          <div className="promo-tier" key={tier.uid}>
            <MoneyInput
              label={`Mốc ${index + 1} — nạp từ`}
              icon={<InlineFieldLabel icon={<Wallet size={18} weight="bold" aria-hidden="true" />} text="Nạp từ (≥)" />}
              placeholder="Số tiền nạp"
              value={tier.charge}
              disabled={disabled}
              max={999_999_999}
              onChange={(value) => update(tier.uid, { charge: value })}
            />
            <MoneyInput
              label={`Mốc ${index + 1} — ${kind === 'free' ? 'tặng thêm' : 'phần trăm tặng'}`}
              icon={
                <InlineFieldLabel
                  icon={kind === 'free' ? <Gift size={18} weight="bold" aria-hidden="true" /> : <Percent size={18} weight="bold" aria-hidden="true" />}
                  text={valueLabel}
                />
              }
              placeholder={kind === 'free' ? 'Số tiền tặng' : 'Phần trăm tặng'}
              currency={kind === 'free' ? 'đ' : '%'}
              value={tier.value}
              disabled={disabled}
              max={kind === 'free' ? 999_999_999 : 100}
              onChange={(value) => update(tier.uid, { value })}
            />
            <IconButton
              label={`Xóa mốc ${index + 1}`}
              icon={<Trash size={18} weight="bold" />}
              className="promo-delete"
              disabled={disabled}
              onClick={() => onChange(tiers.filter((item) => item.uid !== tier.uid))}
            />
          </div>
        ))
      )}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => onChange([...tiers, { uid: nextUid(), charge: null, value: null }])}
        >
          <Plus size={16} weight="bold" aria-hidden="true" /> Thêm mốc
        </Button>
      </div>
    </div>
  )
}
