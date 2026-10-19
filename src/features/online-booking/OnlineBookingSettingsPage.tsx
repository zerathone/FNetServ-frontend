import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getOnlineBookAdminMachines,
  getOnlineBookConfig,
  putOnlineBookConfig,
  saveOnlineBookMachines,
  type ConfigFieldError,
  type ConfigRow,
  type ConfigSetting,
  type ConfigStation,
  type ConfigTime,
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
  error?: string
  onChange: (value: number) => void
}

function NumField({ label, hint, unit, value, min, max, error, onChange }: NumFieldProps) {
  return (
    <label className="ds-field">
      <span className="ds-field__label">
        {label} <span className="ob-field__unit">({unit})</span>
      </span>
      <input
        className="ds-input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {error ? <span className="ds-field__error">{error}</span> : hint ? <span className="ds-field__hint">{hint}</span> : null}
    </label>
  )
}

export function OnlineBookingSettingsPage() {
  const queryClient = useQueryClient()
  const [settingDraft, setSettingDraft] = useState<ConfigSetting | null>(null)
  const [timeDraft, setTimeDraft] = useState<ConfigTime | null>(null)
  const [stationDraft, setStationDraft] = useState<ConfigStation | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ConfigFieldError[]>([])
  const [machineOverrides, setMachineOverrides] = useState<Record<number, boolean>>({})

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

  // Hook dùng chung cho 3 nút Lưu (mỗi dòng JSON lưu riêng, tên "use…" để ESLint coi là custom hook).
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

  return (
    <section className="ob-settings">
      <PageHeader
        eyebrow="Đặt máy online"
        title="Cấu hình đặt máy"
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
        <section className="ob-settings__card">
          <header>
            <strong>Cài đặt chính</strong>
          </header>
          <div className="ob-settings__grid">
            <label className="ds-field ob-toggle">
              <input
                type="checkbox"
                checked={settingDraft.enabled === 1}
                onChange={(event) => setSettingDraft({ ...settingDraft, enabled: event.target.checked ? 1 : 0 })}
              />
              <span>Bật tính năng đặt máy online</span>
            </label>
            <MoneyInput
              label="Phí đặt chỗ mỗi đơn"
              value={settingDraft.fee}
              min={0}
              max={10_000_000}
              error={errorFor('setting', 'fee')}
              hint="0 … 10.000.000 đ, cộng vào tổng mỗi đơn."
              onChange={(value) => setSettingDraft({ ...settingDraft, fee: value ?? 0 })}
            />
            <label className="ds-field">
              <span className="ds-field__label">Chế độ duyệt</span>
              <Segmented
                value={settingDraft.approval_mode === 1 ? 'manual' : 'auto'}
                ariaLabel="Chế độ duyệt"
                options={[
                  { value: 'manual', label: 'Duyệt tay' },
                  { value: 'auto', label: 'Tự động' },
                ]}
                onChange={(value) => setSettingDraft({ ...settingDraft, approval_mode: value === 'manual' ? 1 : 0 })}
              />
              {errorFor('setting', 'approval_mode') ? (
                <span className="ds-field__error">{errorFor('setting', 'approval_mode')}</span>
              ) : (
                <span className="ds-field__hint">Mặc định duyệt tay; chỉ bật tự động khi đã chạy ổn.</span>
              )}
            </label>
          </div>
          <footer>
            <Button type="button" variant="primary" loading={saveSettingMutation.isPending} onClick={() => saveSettingMutation.mutate({ setting: settingDraft })}>
              Lưu cài đặt chính
            </Button>
          </footer>
        </section>
      ) : null}

      {timeDraft ? (
        <section className="ob-settings__card">
          <header>
            <strong>Thời gian đặt đơn</strong>
          </header>
          <div className="ob-settings__grid">
            <NumField
              label="Đặt trước tối đa"
              unit="phút"
              min={0}
              max={180}
              value={timeDraft.max_ahead}
              error={errorFor('time', 'max_ahead')}
              hint="Bắt đầu muộn nhất sau N phút kể từ lúc đặt."
              onChange={(v) => setTimeDraft({ ...timeDraft, max_ahead: v })}
            />
            <NumField
              label="Số giờ tối đa mỗi đơn"
              unit="giờ"
              min={1}
              max={24}
              value={timeDraft.max_hours}
              error={errorFor('time', 'max_hours')}
              onChange={(v) => setTimeDraft({ ...timeDraft, max_hours: v })}
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
            />
            <NumField
              label="Hết hạn chờ duyệt"
              unit="phút"
              min={1}
              max={120}
              value={timeDraft.approval_timeout}
              error={errorFor('time', 'approval_timeout')}
              onChange={(v) => setTimeDraft({ ...timeDraft, approval_timeout: v })}
            />
          </div>
          <footer>
            <Button type="button" variant="primary" loading={saveTimeMutation.isPending} onClick={() => saveTimeMutation.mutate({ time: timeDraft })}>
              Lưu thời gian đặt đơn
            </Button>
          </footer>
        </section>
      ) : null}

      {stationDraft ? (
        <section className="ob-settings__card">
          <header>
            <strong>Máy trạm</strong>
          </header>
          <div className="ob-settings__grid">
            <NumField
              label="Khoá đăng nhập trước giờ đặt"
              unit="phút"
              min={30}
              max={180}
              value={stationDraft.lock_window}
              error={errorFor('station', 'lock_window')}
              hint="Chặn người khác login từ (giờ đặt − N phút)."
              onChange={(v) => setStationDraft({ ...stationDraft, lock_window: v })}
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
            />
          </div>
          <footer>
            <Button type="button" variant="primary" loading={saveStationMutation.isPending} onClick={() => saveStationMutation.mutate({ station: stationDraft })}>
              Lưu máy trạm
            </Button>
          </footer>
        </section>
      ) : null}

      <section className="ob-settings__card">
        <header>
          <strong>Máy cho đặt online</strong>
          <span>{machinesQuery.data?.machines.length ?? 0} máy</span>
        </header>
        {machinesQuery.isLoading ? (
          <StateView title="Đang tải danh sách máy…" />
        ) : machinesQuery.isError ? (
          <StateView title="Không tải được danh sách máy" description={describeBookingError(machinesQuery.error)} />
        ) : (
          <>
            {machineGroups.map((group) => (
              <div key={group.id} className="ob-settings__machine-group">
                <h3>{group.name}</h3>
                <table className="ob-table">
                  <thead>
                    <tr>
                      <th>Cho đặt online</th>
                      <th>Máy</th>
                      <th>Bảng giá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.machines.map((machine) => {
                      const enabled = machineOverrides[machine.machineId] ?? machine.enabled
                      return (
                        <tr key={machine.machineId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={enabled}
                              aria-label={`Cho đặt online máy ${machine.pc}`}
                              onChange={(event) =>
                                setMachineOverrides((prev) => ({ ...prev, [machine.machineId]: event.target.checked }))
                              }
                            />
                          </td>
                          <td>{machine.pc}</td>
                          <td>
                            <div className="ob-calendar__slots">
                              {machine.prices.length === 0 ? (
                                <span className="ob-table__sub">Chưa có giá hội viên</span>
                              ) : (
                                machine.prices.map((price) => (
                                  <span key={price.userGroupId} className="ob-calendar__slot">
                                    {price.userGroup}: {new Intl.NumberFormat('vi-VN').format(price.pricePerHour)} đ/giờ
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            <footer>
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
                Lưu danh sách máy
              </Button>
            </footer>
          </>
        )}
      </section>
    </section>
  )
}
