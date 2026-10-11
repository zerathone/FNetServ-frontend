import { useQuery } from '@tanstack/react-query'
import { getWorkstationHardware, type WorkstationHardware, type WorkstationRuntime } from '../../api/workstations'
import { InlineAlert, StatusBadge } from '../../design-system/components'
import { getWinLicenseView } from './workstationModel'

// Phan "Ban quyen Windows" + "Phan cung" trong nhom Thong tin ky thuat cua drawer chi tiet may.
// Chi mount khi nhom duoc mo rong (InspectorGroup khong render children luc thu gon) nen query
// phan cung chi chay khi nguoi dung that su xem -- du lieu lay tu RAM Server, re nhung khong
// can goi cho moi lan mo drawer.

const NO_DATA = '—'

function num(value: number | null | undefined, unit: string, digits = 0) {
  if (value === null || value === undefined) return null
  return `${value.toFixed(digits)}${unit}`
}

/** Ghep cac phan co gia tri bang " · "; khong phan nao co gia tri -> '—'. */
function joinParts(parts: Array<string | null | undefined>) {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(' · ') : NO_DATA
}

function ramSummary(ram: WorkstationHardware['ram']) {
  const total =
    ram.usedGB !== null && ram.availableGB !== null ? ram.usedGB + ram.availableGB : null
  return joinParts([
    total !== null ? `${num(ram.usedGB, '', 1)} / ${num(total, '', 1)} GB` : null,
    num(ram.loadPct, '%'),
  ])
}

function WinLicenseBlock({ machine }: { machine: WorkstationRuntime }) {
  const lic = getWinLicenseView(machine)
  return (
    <section className="ws-tech-block">
      <h4 className="ws-tech-block__title">Bản quyền Windows</h4>
      {lic ? (
        <dl className="ws-detail-list ws-detail-list--wide">
          <div>
            <dt>Trạng thái</dt>
            <dd>
              <StatusBadge tone={lic.tone}>{lic.label}</StatusBadge>
              {lic.graceText ? <span className="ws-tech-block__hint">{lic.graceText}</span> : null}
            </dd>
          </div>
          <div><dt>Key (5 ký tự cuối)</dt><dd>{lic.pkey || NO_DATA}</dd></div>
          <div><dt>Kênh</dt><dd>{lic.channel || NO_DATA}</dd></div>
        </dl>
      ) : (
        <p className="ws-muted">
          Chưa có dữ liệu bản quyền Windows — máy trạm chưa gửi lên (client cũ hoặc Server vừa khởi động lại).
        </p>
      )}
    </section>
  )
}

function HardwareBlock({ hostName }: { hostName: string }) {
  const query = useQuery({
    queryKey: ['workstation-hardware', hostName],
    queryFn: () => getWorkstationHardware(hostName),
    staleTime: 15_000,
  })
  const hw = query.data?.hardware ?? null

  return (
    <section className="ws-tech-block">
      <h4 className="ws-tech-block__title">Phần cứng</h4>
      {query.isLoading ? (
        <p className="ws-muted">Đang tải thông tin phần cứng…</p>
      ) : query.isError ? (
        <InlineAlert tone="warning">
          Không tải được thông tin phần cứng: {(query.error as Error).message}
        </InlineAlert>
      ) : hw ? (
        <>
          <dl className="ws-detail-list ws-detail-list--wide">
            <div>
              <dt>CPU</dt>
              <dd>
                {joinParts([
                  hw.cpu.name,
                  hw.cpu.cores !== null && hw.cpu.threads !== null
                    ? `${hw.cpu.cores} nhân / ${hw.cpu.threads} luồng`
                    : null,
                ])}
              </dd>
            </div>
            <div>
              <dt>Tải CPU</dt>
              <dd>{joinParts([num(hw.cpu.loadPct, '%'), num(hw.cpu.tempC, ' °C'), num(hw.cpu.powerW, ' W')])}</dd>
            </div>
            <div><dt>GPU</dt><dd>{hw.gpu.name || NO_DATA}</dd></div>
            <div>
              <dt>Tải GPU</dt>
              <dd>
                {joinParts([
                  num(hw.gpu.loadPct, '%'),
                  num(hw.gpu.tempC, ' °C'),
                  num(hw.gpu.powerW, ' W'),
                  num(hw.gpu.memoryMB, ' MB VRAM'),
                ])}
              </dd>
            </div>
            <div><dt>RAM</dt><dd>{ramSummary(hw.ram)}</dd></div>
            <div><dt>Bo mạch chủ</dt><dd>{hw.motherboard || NO_DATA}</dd></div>
            <div><dt>Mạng</dt><dd>{joinParts([hw.network.name, num(hw.network.loadPct, '%')])}</dd></div>
            <div>
              <dt>Ổ cứng</dt>
              <dd>{joinParts([hw.storage.name, num(hw.storage.loadPct, '%'), num(hw.storage.tempC, ' °C')])}</dd>
            </div>
          </dl>
          {hw.updatedAtSec ? (
            <p className="ws-tech-block__hint">
              Cập nhật lúc {new Date(hw.updatedAtSec * 1000).toLocaleTimeString('vi-VN')}
            </p>
          ) : null}
        </>
      ) : (
        <p className="ws-muted">
          Chưa có dữ liệu phần cứng. Hãy kiểm tra máy trạm đã bật giám sát phần cứng chưa.
        </p>
      )}
    </section>
  )
}

export function MachineTechExtras({ machine }: { machine: WorkstationRuntime }) {
  return (
    <>
      <WinLicenseBlock machine={machine} />
      <HardwareBlock hostName={machine.hostName} />
    </>
  )
}
