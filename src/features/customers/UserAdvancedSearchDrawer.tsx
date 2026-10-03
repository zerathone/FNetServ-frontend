import { useState } from 'react'
import { Button, CheckboxInput, DateRangePicker, Drawer, Segmented } from '../../design-system/components'
import {
  defaultAdvForm,
  toAdvFilter,
  validateAdvForm,
  type AdvFilter,
  type AdvForm,
  type FormErrors,
  type SortDir,
  type TriState,
} from './userAdminModel'

const FORM_ID = 'user-adv-search-form'

const SORT_DIR_OPTIONS: Array<{ value: SortDir; label: string }> = [
  { value: 'asc', label: 'Tăng dần' },
  { value: 'desc', label: 'Giảm dần' },
]

const TRI_YN_OPTIONS: Array<{ value: TriState; label: string }> = [
  { value: 'yes', label: 'Có' },
  { value: 'no', label: 'Không có' },
]

type Props = {
  open: boolean
  onClose: () => void
  onApply: (filter: AdvFilter) => void
  onClear: () => void
}

/**
 * \"Tìm kiếm nâng cao\" (CUserSearchAdvDlg) trong Drawer. Component luôn được mount ở trang để giữ
 * giá trị form giữa các lần mở; kết quả hiển thị ở danh sách chính của trang.
 */
export function UserAdvancedSearchDrawer({ open, onClose, onApply, onClear }: Props) {
  const [form, setForm] = useState<AdvForm>(() => defaultAdvForm())
  const [errors, setErrors] = useState<FormErrors<AdvForm>>({})

  const update = <K extends keyof AdvForm>(key: K, value: AdvForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = () => {
    const found = validateAdvForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onApply(toAdvFilter(form))
    onClose()
  }

  const clear = () => {
    setForm(defaultAdvForm())
    setErrors({})
    onClear()
  }

  /** Cặp Tối thiểu + Tối đa dùng component CheckboxInput từ design system. */
  const moneyPairField = (
    minUseKey: 'useMinPaid' | 'useMinRemain',
    minKey: 'minPaid' | 'minRemain',
    maxUseKey: 'useMaxPaid' | 'useMaxRemain',
    maxKey: 'maxPaid' | 'maxRemain',
  ) => (
    <div className="user-admin__money-pair">
      <CheckboxInput
        label="Tối thiểu"
        checked={form[minUseKey]}
        onCheckedChange={(v) => update(minUseKey, v)}
        placeholder="Số tiền (đ)"
        inputMode="numeric"
        maxLength={11}
        value={form[minKey]}
        disabled={!form[minUseKey]}
        error={errors[minKey]}
        onChange={(e) => update(minKey, e.target.value.trim())}
      />
      <CheckboxInput
        label="Tối đa"
        checked={form[maxUseKey]}
        onCheckedChange={(v) => update(maxUseKey, v)}
        placeholder="Số tiền (đ)"
        inputMode="numeric"
        maxLength={11}
        value={form[maxKey]}
        disabled={!form[maxUseKey]}
        error={errors[maxKey]}
        onChange={(e) => update(maxKey, e.target.value.trim())}
      />
    </div>
  )

  /** Sắp xếp — [☐ Sắp xếp | Tăng dần · Giảm dần] kiểu ds-checkbox-input:
   * prefix xám + border-right + Segmented bên phải, tất cả trong 1 border box.
   * Unchecked → opacity mờ, segmented disabled. Checked → default giảm dần. */
  const sortField = (key: 'sortPaid' | 'sortRemain') => {
    const current = form[key]
    const enabled = current !== 'none'
    return (
      <div className={`ds-checkbox-input user-admin__sort-field${enabled ? '' : ' is-off'}`}>
        <label className="ds-checkbox-input__prefix">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => update(key, e.target.checked ? 'desc' : 'none')}
          />
          <span>Sắp xếp</span>
        </label>
        <Segmented
          ariaLabel="Chiều sắp xếp"
          value={enabled ? current : 'desc'}
          options={SORT_DIR_OPTIONS}
          disabled={!enabled}
          onChange={(value) => update(key, value as SortDir)}
        />
      </div>
    )
  }

  /** CCCD / Điện thoại — [☐ label | Có · Không có] trong 1 border box.
   * Unchecked → 'any' (không lọc) + segmented disabled. Checked → default 'yes'. */
  const triField = (key: 'idNumber' | 'phone', label: string) => {
    const current = form[key]
    const enabled = current !== 'any'
    return (
      <div className={`ds-checkbox-input user-admin__tri-field${enabled ? '' : ' is-off'}`}>
        <label className="ds-checkbox-input__prefix">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => update(key, e.target.checked ? 'yes' : 'any')}
          />
          <span>{label}</span>
        </label>
        <Segmented
          ariaLabel={label}
          value={enabled ? current : 'yes'}
          options={TRI_YN_OPTIONS}
          disabled={!enabled}
          onChange={(value) => update(key, value as TriState)}
        />
      </div>
    )
  }

  return (
    <Drawer
      open={open}
      title="Tìm kiếm nâng cao"
      description="Lọc hội viên theo số tiền, khoảng thời gian nạp, CCCD và điện thoại."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={clear}>
            Xóa bộ lọc
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary">
            Tìm
          </Button>
        </>
      }
    >
      <div className="user-admin">
        <form
          id={FORM_ID}
          className="user-admin__stack"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <section className="user-admin__section">
            <h3>Đã nạp</h3>
            {moneyPairField('useMinPaid', 'minPaid', 'useMaxPaid', 'maxPaid')}
            <div className="user-admin__lapse-field">
              <div className={`user-admin__lapse-row${form.useLapse ? '' : ' is-off'}`}>
                <label className="user-admin__lapse-prefix">
                  <input
                    type="checkbox"
                    checked={form.useLapse}
                    onChange={(event) => update('useLapse', event.target.checked)}
                  />
                  <span>Thời gian nạp</span>
                </label>
                <DateRangePicker
                  fromDate={form.lapseFrom}
                  toDate={form.lapseTo}
                  onFromDateChange={(value) => { update('lapseFrom', value) }}
                  onToDateChange={(value) => { update('lapseTo', value) }}
                />
              </div>
              {errors.lapseFrom ? <span className="ds-field__error" role="alert">{errors.lapseFrom}</span> : null}
              {errors.lapseTo ? <span className="ds-field__error" role="alert">{errors.lapseTo}</span> : null}
            </div>
            {sortField('sortPaid')}
          </section>

          <section className="user-admin__section">
            <h3>Còn lại</h3>
            {moneyPairField('useMinRemain', 'minRemain', 'useMaxRemain', 'maxRemain')}
            {sortField('sortRemain')}
          </section>

          <section className="user-admin__section">
            <h3>Thông tin liên hệ</h3>
            {triField('idNumber', 'Số CCCD')}
            {triField('phone', 'Điện thoại')}
          </section>
        </form>
      </div>
    </Drawer>
  )
}
