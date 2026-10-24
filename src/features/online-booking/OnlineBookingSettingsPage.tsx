import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CaretDown, Clock, Desktop, DesktopTower, GearSix } from '@phosphor-icons/react'
import {
  getOnlineBookAdminMachines,
  getOnlineBookConfig,
  putOnlineBookConfig,
  saveOnlineBookMachines,
  type AdminMachine,
  type ConfigFieldError,
  type ConfigRow,
  type ConfigSetting,
  type ConfigStation,
  type ConfigTime,
  type MachinePrice,
} from '../../api/onlineBooking'
import {
  Button,
  InlineAlert,
  MoneyInput,
  PageHeader,
  Segmented,
  StateView,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { describeBookingError, getConfigFieldErrors } from './onlineBookingModel'
import './online-booking.css'

const ROW_LABEL: Record<ConfigRow, string> = {
  setting: 'Cài đặt chính',
  time: 'Thời gian đặt đơn',
  station: 'Máy trạm',
}

type NumFieldProps = {
  label: string
  hint?: string
  unit: string
  value: number
  min: number
  max: number
  /** Bước nhảy của ô số. Mặc định 1 (số nguyên). */
  step?: number
  error?: string
  onChange: (value: number) => void
  /** Gọi khi người dùng xong một lần nhập (rời ô hoặc nhấn Enter): lúc đó mới tự lưu. */
  onCommit: () => void
}

type SelectFieldProps = {
  label: string
  hint?: string
  value: number
  options: { value: number; label: string }[]
  error?: string
  onChange: (value: number) => void
  onCommit: (value: number) => void
}

type SettingRowProps = {
  label: string
  /** Id của control bên trong; bỏ trống khi control không phải một input (nhãn thành <span>). */
  htmlFor?: string
  hint?: string
  error?: string
  children: ReactNode
}

/** Kiểu trang cài đặt của Chrome: nhãn + gợi ý bên trái, control bên phải, các hàng ngăn bằng đường kẻ. */
function SettingRow({ label, htmlFor, hint, error, children }: SettingRowProps) {
  return (
    <div className="ob-row">
      <div className="ob-row__text">
        {htmlFor ? (
          <label className="ob-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="ob-row__label">{label}</span>
        )}
        {error ? (
          <span className="ds-field__error" role="alert">{error}</span>
        ) : hint ? (
          <span className="ds-field__hint">{hint}</span>
        ) : null}
      </div>
      <div className="ob-row__control">{children}</div>
    </div>
  )
}

/** Nhóm các hàng liên quan: một hàng tiêu đề, các hàng con thụt vào. */
function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ob-row-group" role="group" aria-label={title}>
      <div className="ob-row ob-row--title">
        <span className="ob-row__label">{title}</span>
      </div>
      {children}
    </div>
  )
}

type SettingsCardProps = {
  icon: ReactNode
  title: string
  summary: ReactNode
  status?: string
  /** Có `collapsible`: cả header là nút bấm để thu gọn/mở rộng. */
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  /** Thân card không phải danh sách hàng (vd bảng máy) nên cần lề trong. */
  padded?: boolean
  /** Khóa mọi control trong thân card (fieldset disabled) — dùng khi tính năng đang tắt. */
  disabled?: boolean
  /** Control đặt ở bên phải header (vd công tắc bật/tắt, nút Lưu). Card `collapsible` đặt nó cạnh nút thu gọn (không lồng nút trong nút). */
  headerAction?: ReactNode
  children: ReactNode
}

/** Nhóm cài đặt kiểu Windows 11: icon, tiêu đề + tóm tắt giá trị, mũi tên thu gọn/mở rộng. */
function SettingsCard({ icon, title, summary, status, collapsible, open = true, onToggle, padded, disabled, headerAction, children }: SettingsCardProps) {
  const bodyId = useId()
  const caret = <CaretDown size={18} weight="bold" aria-hidden="true" className={`ob-card__caret${open ? ' is-open' : ''}`} />
  const content = (
    <>
      <span className="ob-card__icon" aria-hidden="true">{icon}</span>
      <span className="ob-card__titles">
        <strong>{title}</strong>
        <span className="ob-card__summary">{summary}</span>
      </span>
      {status ? <span className="ob-settings__saving">{status}</span> : null}
      {collapsible && !headerAction ? caret : null}
    </>
  )
  return (
    <section className="ob-settings__card">
      {collapsible ? (
        <div className="ob-card__headrow">
          <button type="button" className="ob-card__head ob-card__head--button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
            {content}
          </button>
          {headerAction ? (
            <>
              <div className="ob-card__headrow-action">{headerAction}</div>
              {/* Mũi tên nằm ngoài cùng bên phải; nút tiêu đề ở bên trái đã là nút thu gọn chính nên nút này chỉ để bấm cho tiện. */}
              <button type="button" className="ob-card__caretbtn" tabIndex={-1} aria-hidden="true" onClick={onToggle}>
                {caret}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="ob-card__head">
          {content}
          {headerAction}
        </div>
      )}
      {open ? (
        <div id={bodyId} className={padded ? 'ob-card__body ob-card__body--padded' : 'ob-card__body'}>
          <fieldset className="ob-fieldset" disabled={disabled}>
            {children}
          </fieldset>
        </div>
      ) : null}
    </section>
  )
}

const MONEY = new Intl.NumberFormat('vi-VN')

/** task OB-R8: miền rời rạc của "giữ máy khi khách đến trễ" — khớp `Validate` phía server (0 hoặc 15…30). */
const LATE_HOLD_OPTIONS = [
  { value: 0, label: 'Không giới hạn — giữ tới hết khung' },
  { value: 15, label: '15 phút' },
  { value: 20, label: '20 phút' },
  { value: 25, label: '25 phút' },
  { value: 30, label: '30 phút' },
]

/** task OB-R8: số phút → câu người đọc được ("4 giờ", "1 ngày", "1 ngày 12 giờ", "1 giờ 30 phút"). */
function describeMinutes(minutes: number): string {
  if (minutes <= 0) return '0 phút'
  if (minutes < 60) return `${minutes} phút`
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const mins = minutes % 60
  return [days ? `${days} ngày` : '', hours ? `${hours} giờ` : '', mins ? `${mins} phút` : '']
    .filter(Boolean)
    .join(' ')
}

/** Giá trị + đơn vị trong dòng tóm tắt: chữ sáng hơn phần còn lại để dễ quét mắt. */
const val = (text: string) => <b className="ob-card__val">{text}</b>

function joinSummary(parts: ReactNode[]) {
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? ' · ' : null}
      {part}
    </Fragment>
  ))
}

type MachineGroupPanelProps = {
  name: string
  prices: MachinePrice[]
  machines: AdminMachine[]
  isSelected: (machine: AdminMachine) => boolean
  /** Máy đang khác bản đã lưu (chưa lưu): tích mới → nền xanh, bỏ tích máy đang có → nền đỏ, tới khi lưu. */
  isChanged: (machine: AdminMachine) => boolean
  open: boolean
  onToggleOpen: () => void
  onToggleMachine: (machineId: number, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
}

/** Một nhóm máy: [chọn tất cả] [mũi tên + tên nhóm + bảng giá ... đã chọn/tổng], thân là danh sách máy xếp trái→phải, trên→dưới. */
function MachineGroupPanel({ name, prices, machines, isSelected, isChanged, open, onToggleOpen, onToggleMachine, onToggleAll }: MachineGroupPanelProps) {
  const bodyId = useId()
  const checkAllRef = useRef<HTMLInputElement>(null)
  const total = machines.length
  const count = machines.filter(isSelected).length
  const full = total > 0 && count === total

  useEffect(() => {
    if (checkAllRef.current) checkAllRef.current.indeterminate = count > 0 && !full
  }, [count, full])

  return (
    <div className="ob-mg">
      <div className="ob-mg__head">
        <input
          ref={checkAllRef}
          type="checkbox"
          className="ob-mg__all"
          checked={full}
          aria-label={`Chọn tất cả máy nhóm ${name}`}
          title="Chọn / bỏ chọn tất cả máy trong nhóm"
          onChange={(event) => onToggleAll(event.target.checked)}
        />
        <button type="button" className="ob-mg__toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggleOpen}>
          <CaretDown size={16} weight="bold" aria-hidden="true" className={`ob-card__caret${open ? ' is-open' : ''}`} />
          <strong className="ob-mg__name">{name}</strong>
          <span className="ob-mg__prices">
            {prices.length === 0 ? (
              <span className="ob-table__sub">Chưa có giá hội viên</span>
            ) : (
              prices.map((price) => (
                <span key={price.userGroupId} className="ob-calendar__slot">
                  {price.userGroup}: {val(`${MONEY.format(price.pricePerHour)} đ/giờ`)}
                </span>
              ))
            )}
          </span>
          <span className={`ob-mg__count${full ? ' is-full' : ''}`} title="Máy được chọn / tổng số máy trong nhóm">
            {count}/{total}
          </span>
        </button>
      </div>
      {open ? (
        <ul id={bodyId} className="ob-mg__list">
          {machines.map((machine) => {
            const selected = isSelected(machine)
            const changeClass = isChanged(machine) ? (selected ? ' is-added' : ' is-removed') : ''
            return (
            <li key={machine.machineId}>
              <label className={`ob-mg__item${changeClass}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => onToggleMachine(machine.machineId, event.target.checked)}
                />
                <span>{machine.pc}</span>
              </label>
            </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
/** Ô chọn một giá trị trong danh sách rời rạc (vd thời gian giữ máy: 0 / 15 / 20 / 25 / 30 phút). */
function SelectField({ label, hint, value, options, error, onChange, onCommit }: SelectFieldProps) {
  const id = useId()
  return (
    <SettingRow label={label} htmlFor={id} hint={hint} error={error}>
      <select
        id={id}
        className="ds-select ob-row__select"
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(next)
          onCommit(next)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </SettingRow>
  )
}

function NumField({ label, hint, unit, value, min, max, step, error, onChange, onCommit }: NumFieldProps) {
  const id = useId()
  return (
    <SettingRow label={label} htmlFor={id} hint={hint} error={error}>
      <span className={`ds-money-input ob-row__numbox${error ? ' ds-money-input--error' : ''}`}>
          <input
          id={id}
          className="ds-money-input__control"
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(Number(event.target.value))}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
    </SettingRow>
  )
}

export function OnlineBookingSettingsPage() {
  const queryClient = useQueryClient()
  const [settingDraft, setSettingDraft] = useState<ConfigSetting | null>(null)
  const [timeDraft, setTimeDraft] = useState<ConfigTime | null>(null)
  const [stationDraft, setStationDraft] = useState<ConfigStation | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ConfigFieldError[]>([])
  const [machineOverrides, setMachineOverrides] = useState<Record<number, boolean>>({})
  // Hai nhóm dài mặc định thu gọn (tóm tắt đã ở header).
  const [timeOpen, setTimeOpen] = useState(false)
  const [machinesOpen, setMachinesOpen] = useState(false)
  // Nhóm máy mặc định thu gọn: chỉ nhóm được bấm mở mới có khoá.
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({})

  const configQuery = useQuery({ queryKey: ['onlinebook-config'], queryFn: getOnlineBookConfig })
  const machinesQuery = useQuery({ queryKey: ['onlinebook-admin-machines'], queryFn: getOnlineBookAdminMachines })

  useEffect(() => {
    if (!configQuery.data) return
    setSettingDraft(configQuery.data.setting)
    setTimeDraft(configQuery.data.time)
    setStationDraft(configQuery.data.station)
  }, [configQuery.data])

  useEffect(() => {
    setMachineOverrides({})
  }, [machinesQuery.data])

  const errorFor = (row: ConfigRow, key: string) => fieldErrors.find((e) => e.row === row && e.key === key)?.message

  // Hook dùng chung cho 3 dòng cấu hình (mỗi dòng JSON lưu riêng, tên "use…" để ESLint coi là custom hook).
  function useSaveConfigMutation() {
    return useMutation({
      mutationFn: putOnlineBookConfig,
      onSuccess: (data) => {
        queryClient.setQueryData(['onlinebook-config'], data)
        setFieldErrors([])
        pushToast('Đã lưu cấu hình.', 'success')
      },
      onError: (error) => {
        const errors = getConfigFieldErrors(error) ?? []
        setFieldErrors(errors)
        if (errors.length === 0) pushToast(describeBookingError(error), 'error')
      },
    })
  }

  const saveSettingMutation = useSaveConfigMutation()
  const saveTimeMutation = useSaveConfigMutation()
  const saveStationMutation = useSaveConfigMutation()

  // Tự lưu: công tắc/lựa chọn lưu ngay khi đổi; ô số lưu khi rời ô. Không đổi so với máy chủ thì bỏ qua.
  const unchanged = (draft: object, saved: object | undefined) => !saved || JSON.stringify(draft) === JSON.stringify(saved)
  const commitSetting = (draft: ConfigSetting) => {
    if (unchanged(draft, configQuery.data?.setting)) return
    saveSettingMutation.mutate({ setting: draft })
  }
  const commitTime = (draft: ConfigTime) => {
    if (unchanged(draft, configQuery.data?.time)) return
    saveTimeMutation.mutate({ time: draft })
  }
  const commitStation = (draft: ConfigStation) => {
    if (unchanged(draft, configQuery.data?.station)) return
    saveStationMutation.mutate({ station: draft })
  }

  const saveMachinesMutation = useMutation({
    mutationFn: saveOnlineBookMachines,
    onSuccess: () => {
      pushToast('Đã lưu danh sách máy cho đặt online.', 'success')
      setMachineOverrides({})
      void queryClient.invalidateQueries({ queryKey: ['onlinebook-admin-machines'] })
      void queryClient.invalidateQueries({ queryKey: ['onlinebook-board'] })
    },
    onError: (error) => pushToast(describeBookingError(error), 'error'),
  })

  const machineGroups = useMemo(() => {
    const machines = machinesQuery.data?.machines ?? []
    const groups = new Map<number, { name: string; machines: typeof machines }>()
    machines.forEach((m) => {
      const group = groups.get(m.machineGroupId) ?? { name: m.machineGroup, machines: [] }
      group.machines.push(m)
      groups.set(m.machineGroupId, group)
    })
    return Array.from(groups.entries()).map(([id, group]) => ({ id, ...group }))
  }, [machinesQuery.data])

  const machinesDirty = Object.keys(machineOverrides).length > 0
  const isMachineSelected = (m: AdminMachine) => machineOverrides[m.machineId] ?? m.enabled
  // Ghi đè chỉ giữ máy khác với dữ liệu đã lưu, để tích rồi bỏ tích lại không bị tính là chưa lưu.
  const setMachinesSelected = (ids: number[], checked: boolean) =>
    setMachineOverrides((prev) => {
      const next = { ...prev }
      const saved = new Map((machinesQuery.data?.machines ?? []).map((m) => [m.machineId, m.enabled]))
      ids.forEach((id) => {
        if (saved.get(id) === checked) delete next[id]
        else next[id] = checked
      })
      return next
    })
  const bookingEnabled = settingDraft?.enabled === 1

  // Tóm tắt hiện ở header mỗi nhóm để khỏi mở ra mới biết giá trị đang đặt.
  const settingSummary: ReactNode = settingDraft
    ? joinSummary([
        settingDraft.enabled === 1 ? 'Đang bật' : 'Đang tắt',
        <>Phí {val(`${MONEY.format(settingDraft.fee)} đ`)}/đơn</>,
        settingDraft.approval_mode === 1 ? 'Duyệt thủ công' : 'Tự động duyệt',
      ])
    : ''
  const timeSummary: ReactNode = timeDraft
    ? joinSummary([
        <>Đặt trước tối đa {val(describeMinutes(timeDraft.max_ahead))}</>,
        <>Không đặt sát giờ {val(`${timeDraft.min_lead} phút`)}</>,
        <>Mỗi đơn {val(`${timeDraft.min_hours}–${timeDraft.max_hours} giờ`)}</>,
        timeDraft.require_off_within > 0 ? (
          <>Chỉ máy tắt khi đặt trong {val(describeMinutes(timeDraft.require_off_within))}</>
        ) : (
          <>Không bắt máy tắt</>
        ),
        <>Đệm {val(`${timeDraft.buffer} phút`)}</>,
        <>Hết hạn chờ duyệt {val(`${timeDraft.approval_timeout} phút`)}</>,
      ])
    : ''
  const stationSummary: ReactNode = stationDraft
    ? joinSummary([
        <>Khoá đăng nhập trước {val(`${stationDraft.lock_window} phút`)}</>,
        <>Vào máy sớm {val(`${stationDraft.early_login} phút`)}</>,
        stationDraft.late_hold > 0 ? (
          <>Giữ máy khi đến trễ {val(`${stationDraft.late_hold} phút`)}</>
        ) : (
          <>Giữ máy tới hết khung</>
        ),
      ])
    : ''
  const allMachines = machinesQuery.data?.machines ?? []
  const machinesEnabledCount = allMachines.filter((m) => machineOverrides[m.machineId] ?? m.enabled).length
  const machinesSummary: ReactNode = machinesQuery.isLoading
    ? 'Đang tải…'
    : joinSummary([
        <>{val(`${machinesEnabledCount}/${allMachines.length}`)} máy đang cho đặt online</>,
        ...(machinesDirty ? ['chưa lưu'] : []),
      ])
  return (
    <section className="ob-settings">
      <PageHeader
        eyebrow="Đặt máy online"
        title="Thiết lập đặt máy"
        description="Chỉ admin chỉnh được. Mỗi lần lưu, máy chủ kiểm ràng buộc chéo trên cả ba bộ số trước khi ghi."
      />

      {configQuery.isLoading ? <StateView title="Đang tải cấu hình…" /> : null}
      {configQuery.isError ? (
        <StateView
          title="Không tải được cấu hình"
          description={describeBookingError(configQuery.error)}
          action={
            <Button type="button" onClick={() => void configQuery.refetch()}>
              Thử lại
            </Button>
          }
        />
      ) : null}

      {(configQuery.data?.corrupt ?? []).map((row) => (
        <InlineAlert key={row} tone="warning">
          Cấu hình "{ROW_LABEL[row]}" trong cơ sở dữ liệu bị hỏng, đang dùng giá trị mặc định.
        </InlineAlert>
      ))}

      {settingDraft ? (
        <SettingsCard
          icon={<GearSix size={22} weight="regular" aria-hidden="true" />}
          title="Cài đặt chính"
          summary={settingSummary}
          status={saveSettingMutation.isPending ? 'Đang lưu…' : undefined}
          disabled={!bookingEnabled}
          headerAction={
            <label className="ob-card__switch">
              <span>Đặt máy online</span>
              <span className="ob-card__switch-state" aria-hidden="true">{bookingEnabled ? 'Bật' : 'Tắt'}</span>
              <input
                className="ob-switch"
                type="checkbox"
                role="switch"
                checked={bookingEnabled}
                onChange={(event) => {
                  const next: ConfigSetting = { ...settingDraft, enabled: event.target.checked ? 1 : 0 }
                  setSettingDraft(next)
                  commitSetting(next)
                }}
              />
            </label>
          }
        >
          <div className="ob-rows">
            <SettingRow
              label="Chế độ duyệt"
              error={errorFor('setting', 'approval_mode')}
              hint="Mặc định duyệt thủ công; chỉ bật tự động khi đã chạy ổn."
            >
              <Segmented
                value={settingDraft.approval_mode === 1 ? 'manual' : 'auto'}
                ariaLabel="Chế độ duyệt"
                options={[
                  { value: 'manual', label: 'Duyệt thủ công' },
                  { value: 'auto', label: 'Tự động' },
                ]}
                onChange={(value) => {
                  const next: ConfigSetting = { ...settingDraft, approval_mode: value === 'manual' ? 1 : 0 }
                  setSettingDraft(next)
                  commitSetting(next)
                }}
              />
            </SettingRow>
            <SettingRow
              label="Phí đặt chỗ mỗi đơn"
              htmlFor="ob-fee"
              error={errorFor('setting', 'fee')}
              hint="0 … 10.000.000 đ, cộng vào tổng mỗi đơn."
            >
              <MoneyInput
                id="ob-fee"
                label="Phí đặt chỗ mỗi đơn"
                value={settingDraft.fee}
                min={0}
                max={10_000_000}
                error={errorFor('setting', 'fee')}
                onChange={(value) => setSettingDraft({ ...settingDraft, fee: value ?? 0 })}
                onBlur={() => commitSetting(settingDraft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </SettingRow>
          </div>
        </SettingsCard>
      ) : null}

      {timeDraft ? (
        <SettingsCard
          icon={<Clock size={22} weight="regular" aria-hidden="true" />}
          title="Thời gian đặt đơn"
          summary={timeSummary}
          status={saveTimeMutation.isPending ? 'Đang lưu…' : undefined}
          disabled={!bookingEnabled}
          collapsible
          open={timeOpen}
          onToggle={() => setTimeOpen((v) => !v)}
        >
          <div className="ob-rows">
            <SettingGroup title="Thời điểm bắt đầu">
              {/* task OB-R8: nhập theo GIỜ (tối đa 7 ngày), lưu xuống phút. Giá trị cũ không tròn giờ (vd 90
                  phút = 1,5 giờ) vẫn hiển thị đúng và không bị ghi đè khi chỉ rời ô — `unchanged()` lo việc đó. */}
              <NumField
                label="Đặt trước tối đa"
                unit="giờ"
                min={1}
                max={168}
                step={0.5}
                value={timeDraft.max_ahead / 60}
                error={errorFor('time', 'max_ahead')}
                hint={`Bắt đầu muộn nhất sau ${describeMinutes(timeDraft.max_ahead)} kể từ lúc đặt.`}
                onChange={(v) => setTimeDraft({ ...timeDraft, max_ahead: Math.round(v * 60) })}
                onCommit={() => commitTime(timeDraft)}
              />
              <NumField
                label="Không đặt sát giờ"
                unit="phút"
                min={0}
                max={120}
                value={timeDraft.min_lead}
                error={errorFor('time', 'min_lead')}
                hint="Khoảng cách tối thiểu từ lúc đặt đến giờ bắt đầu."
                onChange={(v) => setTimeDraft({ ...timeDraft, min_lead: v })}
                onCommit={() => commitTime(timeDraft)}
              />
              {/* task OB-R8: ngưỡng thay cho luật cứng "máy phải tắt" cũ. */}
              <NumField
                label="Chỉ đặt máy đang tắt khi đặt trong vòng"
                unit="giờ"
                min={0}
                max={168}
                step={0.5}
                value={timeDraft.require_off_within / 60}
                error={errorFor('time', 'require_off_within')}
                hint="Đặt sát giờ hơn mức này thì chỉ chọn được máy đang tắt; xa hơn thì chọn được cả máy đang bật. 0 = không bao giờ bắt máy tắt."
                onChange={(v) => setTimeDraft({ ...timeDraft, require_off_within: Math.round(v * 60) })}
                onCommit={() => commitTime(timeDraft)}
              />
            </SettingGroup>
            <SettingGroup title="Thời lượng đơn">
              {/* task OB-R8: sàn dưới mỗi đơn (trước đây là hằng số 30 phút). */}
              <NumField
                label="Số giờ tối thiểu mỗi đơn"
                unit="giờ"
                min={1}
                max={23}
                value={timeDraft.min_hours}
                error={errorFor('time', 'min_hours')}
                hint="Phải nhỏ hơn số giờ tối đa mỗi đơn."
                onChange={(v) => setTimeDraft({ ...timeDraft, min_hours: v })}
                onCommit={() => commitTime(timeDraft)}
              />
              <NumField
                label="Số giờ tối đa mỗi đơn"
                unit="giờ"
                min={1}
                max={24}
                value={timeDraft.max_hours}
                error={errorFor('time', 'max_hours')}
                onChange={(v) => setTimeDraft({ ...timeDraft, max_hours: v })}
                onCommit={() => commitTime(timeDraft)}
              />
              <NumField
                label="Đệm giữa 2 đơn"
                unit="phút"
                min={0}
                max={60}
                value={timeDraft.buffer}
                error={errorFor('time', 'buffer')}
                hint="Thời gian bàn giao máy giữa 2 đơn liên tiếp."
                onChange={(v) => setTimeDraft({ ...timeDraft, buffer: v })}
                onCommit={() => commitTime(timeDraft)}
              />
            </SettingGroup>
            <NumField
              label="Hết hạn chờ duyệt"
              unit="phút"
              min={1}
              max={120}
              value={timeDraft.approval_timeout}
              error={errorFor('time', 'approval_timeout')}
              onChange={(v) => setTimeDraft({ ...timeDraft, approval_timeout: v })}
              onCommit={() => commitTime(timeDraft)}
            />
          </div>
        </SettingsCard>
      ) : null}

      {stationDraft ? (
        <SettingsCard
          icon={<Desktop size={22} weight="regular" aria-hidden="true" />}
          title="Máy trạm"
          summary={stationSummary}
          status={saveStationMutation.isPending ? 'Đang lưu…' : undefined}
          disabled={!bookingEnabled}
        >
          <div className="ob-rows">
            <NumField
              label="Khoá đăng nhập trước giờ đặt"
              unit="phút"
              min={30}
              max={180}
              value={stationDraft.lock_window}
              error={errorFor('station', 'lock_window')}
              hint="Chặn người khác login từ (giờ đặt − N phút)."
              onChange={(v) => setStationDraft({ ...stationDraft, lock_window: v })}
              onCommit={() => commitStation(stationDraft)}
            />
            <NumField
              label="Cho vào máy sớm"
              unit="phút"
              min={0}
              max={60}
              value={stationDraft.early_login}
              error={errorFor('station', 'early_login')}
              hint="Chủ đơn được vào máy sớm trước giờ đặt; vẫn chỉ chơi đúng số phút đã trả."
              onChange={(v) => setStationDraft({ ...stationDraft, early_login: v })}
              onCommit={() => commitStation(stationDraft)}
            />
            {/* task OB-R8: quá mức này mà chủ đơn chưa vào thì đơn thành "không đến" và máy được nhả. */}
            <SelectField
              label="Giữ máy khi khách đến trễ"
              value={stationDraft.late_hold}
              options={LATE_HOLD_OPTIONS}
              error={errorFor('station', 'late_hold')}
              hint="Quá thời gian này kể từ giờ bắt đầu mà chủ đơn chưa vào máy thì đơn bị tính là không đến và máy được nhả. Không hoàn tiền."
              onChange={(v) => setStationDraft({ ...stationDraft, late_hold: v })}
              onCommit={(v) => commitStation({ ...stationDraft, late_hold: v })}
            />
          </div>
        </SettingsCard>
      ) : null}

      <SettingsCard
        icon={<DesktopTower size={22} weight="regular" aria-hidden="true" />}
        title="Máy cho đặt online"
        summary={machinesSummary}
        status={saveMachinesMutation.isPending ? 'Đang lưu…' : undefined}
        disabled={!bookingEnabled}
        collapsible
        open={machinesOpen}
        onToggle={() => setMachinesOpen((v) => !v)}
        padded
        headerAction={
          <Button
            type="button"
            variant="primary"
            disabled={!machinesDirty}
            loading={saveMachinesMutation.isPending}
            onClick={() => {
              const machines = (machinesQuery.data?.machines ?? []).map((m) => ({
                machineId: m.machineId,
                enabled: machineOverrides[m.machineId] ?? m.enabled,
              }))
              saveMachinesMutation.mutate({ machines })
            }}
          >
            Lưu
          </Button>
        }
      >
        {machinesQuery.isLoading ? (
          <StateView title="Đang tải danh sách máy…" />
        ) : machinesQuery.isError ? (
          <StateView title="Không tải được danh sách máy" description={describeBookingError(machinesQuery.error)} />
        ) : (
          <>
            <div className="ob-mg-list">
              {machineGroups.map((group) => (
                <MachineGroupPanel
                  key={group.id}
                  name={group.name}
                  prices={group.machines[0]?.prices ?? []}
                  machines={group.machines}
                  isSelected={isMachineSelected}
                  isChanged={(m) => m.machineId in machineOverrides}
                  open={Boolean(openGroups[group.id])}
                  onToggleOpen={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                  onToggleMachine={(machineId, checked) => setMachinesSelected([machineId], checked)}
                  onToggleAll={(checked) => setMachinesSelected(group.machines.map((m) => m.machineId), checked)}
                />
              ))}
            </div>
          </>
        )}
      </SettingsCard>
    </section>
  )
}
