import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Circuitry, Cpu, GraphicsCard, HardDrive, Lightning, Memory, Question, Speedometer, Thermometer, Warning, X } from '@phosphor-icons/react'
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
function joinParts(parts: Array<string | null | undefined>) {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(' · ') : NO_DATA
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
function loadTone(pct: number | null): StatusTone {
  if (pct === null) return 'neutral'
  if (pct > 90) return 'danger'
  if (pct > 80) return 'warning'
  return 'success'
}

export function tempTone(celsius: number | null): StatusTone {
  if (celsius === null) return 'neutral'
  if (celsius > 80) return 'danger'
  if (celsius > 70) return 'warning'
  return 'success'
}

/** Chip so hoat dong (nhiet/dien/tai) -- icon rieng cho tung loai chi so + mau theo nguong. */
function StatChip({
  tone,
  icon: Icon,
  children,
}: {
  tone: StatusTone
  icon: typeof Thermometer
  children: ReactNode
}) {
  return (
    <StatusBadge tone={tone}>
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
