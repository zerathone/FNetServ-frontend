import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Circuitry, Cpu, Fan, GraphicsCard, HardDrive, Lightning, Memory, Network, Question, Speedometer, Thermometer, Warning, WindowsLogo, X } from '@phosphor-icons/react'
import { getWorkstationHardware, type WorkstationHardware, type WorkstationRuntime } from '../../api/workstations'
import { InlineAlert, StatusBadge, type StatusTone } from '../../design-system/components'
import { getWinLicenseView } from './workstationModel'

// WinLicenseCell (nhom "Thong tin ky thuat") + HardwareBlock (nhom "Phan cung" rieng) cua
// drawer chi tiet may. Query phan cung (2026-10) da nang len goi o WorkstationWorkspace de
// lay nhiet do CPU/GPU cho dong tom tat luc thu gon -- HardwareBlock goi lai CUNG queryKey
// nen chi doc tu cache co san (khong goi API lan 2) khi nguoi dung mo rong nhom.

const NO_DATA = '—'

export function num(value: number | null | undefined, unit: string, digits = 0) {
  if (value === null || value === undefined) return null
  return `${value.toFixed(digits)}${unit}`
}

/** Ghep cac phan co gia tri bang " · "; khong phan nao co gia tri -> '—'. */
export function joinParts(parts: Array<string | null | undefined>) {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(' · ') : NO_DATA
}

/** Luu luong mang (GB) -> chuoi gon: duoi 1 GB doi sang MB cho de doc. */
export function dataVolume(gb: number | null | undefined) {
  if (gb === null || gb === undefined) return null
  return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(2)} GB`
}

function ramCapacity(ram: WorkstationHardware['ram']) {
  const total =
    ram.usedGB !== null && ram.availableGB !== null ? ram.usedGB + ram.availableGB : null
  return total !== null ? `${num(ram.usedGB, '', 1)} / ${num(total, '', 1)} GB` : null
}

// Nguong canh bao theo yeu cau user (2026-10): tai >90% la danger, >80% warning; nhiet
// do >80°C la danger, >70°C warning. Con lai la "binh thuong" (success). Dien nang tieu
// thu (W) khong co nguong chuan (TDP khac nhau tung CPU/GPU) -> giu tone info, khong suy
// doan nguong.
// Cac moc nguong dung chung voi chu giai o trang Theo doi hoat dong (health-monitor) -- doi o day
// la doi ca logic to mau lan chu giai.
export const LOAD_WARN_PCT = 80
export const LOAD_DANGER_PCT = 90
export const TEMP_WARN_C = 70
export const TEMP_DANGER_C = 80
// Quat GPU (% dieu khien, user chot 2026-10-14): >70% warning, >80% danger -- quat phai quay manh
// thuong la dau hieu GPU nong / tan nhiet kem. Chi co nguong cho %, vong/phut khong co chuan chung.
export const FAN_WARN_PCT = 70
export const FAN_DANGER_PCT = 80

export function loadTone(pct: number | null): StatusTone {
  if (pct === null) return 'neutral'
  if (pct > LOAD_DANGER_PCT) return 'danger'
  if (pct > LOAD_WARN_PCT) return 'warning'
  return 'success'
}

export function tempTone(celsius: number | null): StatusTone {
  if (celsius === null) return 'neutral'
  if (celsius > TEMP_DANGER_C) return 'danger'
  if (celsius > TEMP_WARN_C) return 'warning'
  return 'success'
}

export function fanTone(pct: number | null): StatusTone {
  if (pct === null) return 'neutral'
  if (pct > FAN_DANGER_PCT) return 'danger'
  if (pct > FAN_WARN_PCT) return 'warning'
  return 'success'
}

/** Chip so hoat dong (nhiet/dien/tai) -- icon rieng cho tung loai chi so + mau theo nguong. */
export function StatChip({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: StatusTone
  icon: typeof Thermometer
  title?: string
  children: ReactNode
}) {
  return (
    <StatusBadge tone={tone} title={title}>
      <Icon size={12} weight="bold" />
      {children}
    </StatusBadge>
  )
}

// Icon thay chu cho trang thai -- ten day du chi hien qua tooltip (title cua StatusBadge).
const WIN_LICENSE_ICON: Record<StatusTone, typeof Check> = {
  success: Check,
  danger: X,
  warning: Warning,
  info: Question,
  neutral: Question,
}

/** Badge thu gon o header nhom "Thong tin ky thuat": logo Windows + icon trang thai ban quyen,
    khong kem chu -- ten day du (va so ngay gia han) chi hien qua tooltip. Chua co du lieu -> null. */
export function WinLicenseBadge({ machine }: { machine: WorkstationRuntime }) {
  const lic = getWinLicenseView(machine)
  if (!lic) return null
  const Icon = WIN_LICENSE_ICON[lic.tone]
  return (
    <span className="ws-winlic-line">
      <StatusBadge
        tone={lic.tone}
        title={`Windows: ${lic.label}${lic.graceText ? ` · ${lic.graceText}` : ''}`}
      >
        <WindowsLogo size={14} weight="fill" />
        <Icon size={14} weight="bold" />
      </StatusBadge>
    </span>
  )
}

/** Noi dung dong "Ban quyen Windows" -- dung nhu 1 <dd>, ghep chung dl voi "Phien ban"
    (dt rieng o call site) thay vi tu lam section rieng nhu truoc. */
export function WinLicenseCell({ machine }: { machine: WorkstationRuntime }) {
  const lic = getWinLicenseView(machine)
  const Icon = lic ? WIN_LICENSE_ICON[lic.tone] : Question
  if (!lic) {
    return (
      <span className="ws-muted">
        Chưa có dữ liệu — client cũ hoặc Server vừa khởi động lại
      </span>
    )
  }
  return (
    <div className="ws-winlic-line">
      <StatusBadge tone={lic.tone} title={lic.graceText ? `${lic.label} · ${lic.graceText}` : lic.label}>
        <Icon size={14} weight="bold" />
      </StatusBadge>
      <span className="ws-winlic-sep">·</span>
      <span title="Product key (5 ký tự cuối)">{lic.pkey || NO_DATA}</span>
      <span className="ws-winlic-sep">·</span>
      <span className="ws-winlic-channel" title="Kênh bản quyền (Retail / OEM:DM / Volume:GVLK...)">{lic.channel || NO_DATA}</span>
    </div>
  )
}

// Phan hwm.exe lay hong (hardware.errors, 2026-10-14). Phan con lai van hien so lieu binh thuong.
const HW_ERROR_PART_LABEL: Record<string, string> = {
  hardware: 'Cảm biến phần cứng',
  winlicense: 'Bản quyền Windows',
}

/** Ly do ky thuat cua hwm.exe -> cau de doc; giu nguyen ma goc trong ngoac de doi chieu log. */
function hwErrorText(message: string) {
  if (message.startsWith('timeout')) return `Không phản hồi trong ${message.slice('timeout'.length).trim()}`
  if (message.startsWith('crash')) return `Bị lỗi khi đọc (mã ${message.slice('crash'.length).trim()})`
  return `Không lấy được (${message})`
}

/** Mo ta gon cac phan loi, dung cho tooltip (dong tom tat drawer). */
export function hardwareErrorsTitle(errors: WorkstationHardware['errors']) {
  if (!errors || errors.length === 0) return null
  return errors
    .map((e) => `${HW_ERROR_PART_LABEL[e.part] ?? e.part}: ${hwErrorText(e.message)}`)
    .join('\n')
}

function HardwareErrorsAlert({ errors }: { errors: WorkstationHardware['errors'] }) {
  if (!errors || errors.length === 0) return null
  return (
    <InlineAlert tone="warning">
      Máy trạm gửi thiếu dữ liệu ở lần cập nhật gần nhất:
      <ul className="ws-hw-errors">
        {errors.map((e) => (
          <li key={e.part}>
            <strong>{HW_ERROR_PART_LABEL[e.part] ?? e.part}</strong>: {hwErrorText(e.message)}
          </li>
        ))}
      </ul>
    </InlineAlert>
  )
}

export function HardwareBlock({ hostName }: { hostName: string }) {
  const query = useQuery({
    queryKey: ['workstation-hardware', hostName],
    queryFn: () => getWorkstationHardware(hostName),
    staleTime: 15_000,
  })
  const hw = query.data?.hardware ?? null

  return (
    <>
      {query.isLoading ? (
        <p className="ws-muted">Đang tải thông tin phần cứng…</p>
      ) : query.isError ? (
        <InlineAlert tone="warning">
          Không tải được thông tin phần cứng: {(query.error as Error).message}
        </InlineAlert>
      ) : hw ? (
        <>
          <HardwareErrorsAlert errors={hw.errors} />
          {/* CPU/GPU/RAM/O cung/Bo mach chu dung chung 1 cum + 1 kieu trinh bay: icon+nhan,
              thong tin co dinh, chip hoat dong (nhiet -> dien -> tai, icon rieng tung loai).
              CPU/GPU nhieu thong tin hon nen tach 2 dong (nhan+chip / thong tin co dinh);
              RAM, O cung, Bo mach chu it thong tin hon nen gon 1 dong. */}
          <div className="ws-hw-cluster">
            <div className="ws-hw-cluster__item">
              <span className="ws-hw-cluster__row">
                <span className="ws-hw-cluster__label"><Cpu size={14} weight="bold" /> CPU</span>
                <span className="ws-hw-cluster__stats">
                  {hw.cpu.tempC !== null ? <StatChip tone={tempTone(hw.cpu.tempC)} icon={Thermometer}>{num(hw.cpu.tempC, '°C')}</StatChip> : null}
                  {hw.cpu.powerW !== null ? <StatChip tone="info" icon={Lightning}>{num(hw.cpu.powerW, ' W')}</StatChip> : null}
                  {hw.cpu.loadPct !== null ? <StatChip tone={loadTone(hw.cpu.loadPct)} icon={Speedometer}>{num(hw.cpu.loadPct, '%')}</StatChip> : null}
                </span>
              </span>
              <span className="ws-hw-cluster__meta">
                {joinParts([
                  hw.cpu.name,
                  hw.cpu.cores !== null && hw.cpu.threads !== null
                    ? `${hw.cpu.cores} nhân / ${hw.cpu.threads} luồng`
                    : null,
                ])}
              </span>
            </div>
            <div className="ws-hw-cluster__item">
              <span className="ws-hw-cluster__row">
                <span className="ws-hw-cluster__label"><GraphicsCard size={14} weight="bold" /> GPU</span>
                <span className="ws-hw-cluster__stats">
                  {hw.gpu.tempC !== null ? <StatChip tone={tempTone(hw.gpu.tempC)} icon={Thermometer}>{num(hw.gpu.tempC, '°C')}</StatChip> : null}
                  {hw.gpu.powerW !== null ? <StatChip tone="info" icon={Lightning}>{num(hw.gpu.powerW, ' W')}</StatChip> : null}
                  {hw.gpu.loadPct !== null ? <StatChip tone={loadTone(hw.gpu.loadPct)} icon={Speedometer}>{num(hw.gpu.loadPct, '%')}</StatChip> : null}
                  {hw.gpu.fanRpm != null || hw.gpu.fanPct != null ? (
                    <StatChip
                      // Mau theo % quat (nguong FAN_*); chi co vong/phut (khong co %) -> info nhu cu.
                      tone={hw.gpu.fanPct != null ? fanTone(hw.gpu.fanPct) : 'info'}
                      icon={Fan}
                      title={`Quạt GPU: ${joinParts([num(hw.gpu.fanRpm, ' vòng/phút'), num(hw.gpu.fanPct, '% công suất')])}`}
                    >
                      {joinParts([num(hw.gpu.fanRpm, ' RPM'), num(hw.gpu.fanPct, '%')])}
                    </StatChip>
                  ) : null}
                </span>
              </span>
              <span className="ws-hw-cluster__meta">
                {joinParts([hw.gpu.name, num(hw.gpu.memoryMB, ' MB VRAM')])}
              </span>
            </div>
            <div className="ws-hw-cluster__item ws-hw-cluster__item--flat">
              <span className="ws-hw-cluster__label"><Memory size={14} weight="bold" /> RAM</span>
              <span className="ws-hw-cluster__meta">{ramCapacity(hw.ram) ?? NO_DATA}</span>
              <span className="ws-hw-cluster__stats">
                {hw.ram.loadPct !== null ? <StatChip tone={loadTone(hw.ram.loadPct)} icon={Speedometer}>{num(hw.ram.loadPct, '%')}</StatChip> : null}
              </span>
            </div>
            <div className="ws-hw-cluster__item ws-hw-cluster__item--flat">
              <span className="ws-hw-cluster__label"><HardDrive size={14} weight="bold" /> Ổ cứng</span>
              <span className="ws-hw-cluster__meta">{hw.storage.name || NO_DATA}</span>
              <span className="ws-hw-cluster__stats">
                {hw.storage.tempC !== null ? <StatChip tone={tempTone(hw.storage.tempC)} icon={Thermometer}>{num(hw.storage.tempC, '°C')}</StatChip> : null}
                {hw.storage.loadPct !== null ? <StatChip tone={loadTone(hw.storage.loadPct)} icon={Speedometer}>{num(hw.storage.loadPct, '%')}</StatChip> : null}
              </span>
            </div>
            <div className="ws-hw-cluster__item ws-hw-cluster__item--flat">
              <span className="ws-hw-cluster__label"><Network size={14} weight="bold" /> Mạng</span>
              <span className="ws-hw-cluster__meta">{hw.network.name || NO_DATA}</span>
              <span className="ws-hw-cluster__stats">
                {hw.network.uploadGB !== null ? <StatChip tone="success" icon={ArrowUp}>{dataVolume(hw.network.uploadGB)}</StatChip> : null}
                {hw.network.downloadGB !== null ? <StatChip tone="info" icon={ArrowDown}>{dataVolume(hw.network.downloadGB)}</StatChip> : null}
              </span>
            </div>
            <div className="ws-hw-cluster__item ws-hw-cluster__item--flat">
              <span className="ws-hw-cluster__label"><Circuitry size={14} weight="bold" /> Bo mạch chủ</span>
              <span className="ws-hw-cluster__meta">{hw.motherboard || NO_DATA}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="ws-muted">
          Chưa có dữ liệu phần cứng. Hãy kiểm tra máy trạm đã bật giám sát phần cứng chưa.
        </p>
      )}
    </>
  )
}
