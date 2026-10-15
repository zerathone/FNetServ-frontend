import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { getPrinters, deletePrinter, discoverPrinters, getPrinterServices, printBitmap, savePrinter, savePrinterServices, type Printer, type DiscoveredPrinter } from '../api/printer'
import { getCafeInfo } from '../api/settings'
import { printerHtmlTestTemplate, renderPrinterHtml } from '../features/printers/browserHtmlRaster'
import { pushToast } from '../store/toast'
import { Button, IconButton, Select } from '../design-system/components';
import './printer-settings.css'

const PRINTER_TYPES: Array<{ value: Printer['type']; label: string }> = [
  { value: 0, label: 'A4' },
  { value: 1, label: 'POS 80' },
  { value: 2, label: 'POS 58' },
]

function printerTypeLabel(type: Printer['type']) {
  return PRINTER_TYPES.find((item) => item.value === type)?.label ?? `Loại ${type}`
}

function discoveredType(width: string): Printer['type'] {
  if (width.toUpperCase() === 'K80') return 1
  if (width.toUpperCase() === 'K58') return 2
  return 0
}

/** Ô chọn tất cả: tick khi đủ, gạch ngang (indeterminate) khi chọn một phần. */
function SelectAllCheckbox({ ids, selected, onToggle, children, className }: {
  ids: number[]
  selected: number[]
  onToggle: (checked: boolean) => void
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const count = ids.filter((id) => selected.includes(id)).length
  const all = ids.length > 0 && count === ids.length
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all
  }, [count, all])
  return (
    <label className={className}>
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        disabled={ids.length === 0}
        onChange={(event) => onToggle(event.target.checked)}
      />
      {children}
    </label>
  )
}

export function PrinterSettingsPage() {
  const queryClient = useQueryClient()
  const [editingPrinter, setEditingPrinter] = useState<Partial<Printer> | null>(null)
  const [showDiscover, setShowDiscover] = useState(false)
  const [assignedServiceIds, setAssignedServiceIds] = useState<number[]>([])

  const { data: printers, isLoading } = useQuery({
    queryKey: ['printers'],
    queryFn: getPrinters,
  })

  const servicesQuery = useQuery({
    queryKey: ['printer-services', editingPrinter?.printerId],
    queryFn: () => getPrinterServices(editingPrinter!.printerId!),
    enabled: Boolean(editingPrinter?.printerId),
  })

  useEffect(() => {
    setAssignedServiceIds(
      servicesQuery.data?.groups.flatMap((group) =>
        group.services.filter((service) => service.assigned).map((service) => service.serviceId),
      ) ?? [],
    )
  }, [servicesQuery.data])

  const discoverMutation = useMutation({
    mutationFn: discoverPrinters,
    onError: (error: Error) => {
      pushToast(`Lỗi dò tìm: ${error.message}`, 'error')
    }
  })

  // "Cập nhật" lưu CẢ cấu hình máy in lẫn danh sách dịch vụ gửi đến máy in (trước đây phải bấm nút riêng, quên
  // bấm là mất lựa chọn khi drawer đóng). `serviceIds` chỉ có khi danh mục dịch vụ ĐÃ tải xong — chưa tải/lỗi
  // thì KHÔNG gửi, tránh ghi đè mapping hiện có bằng danh sách rỗng.
  const saveMutation = useMutation({
    mutationFn: async ({ printer, serviceIds }: { printer: Printer; serviceIds?: number[] }) => {
      await savePrinter(printer)
      if (printer.printerId !== undefined && serviceIds) {
        await savePrinterServices(printer.printerId, serviceIds)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] })
      queryClient.invalidateQueries({ queryKey: ['printer-services'] })
      pushToast('Lưu máy in thành công', 'success')
      setEditingPrinter(null)
    },
    onError: (error: Error) => {
      pushToast(`Lỗi lưu máy in: ${error.message}`, 'error')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: deletePrinter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] })
      pushToast('Xóa máy in thành công', 'success')
      setEditingPrinter(null)
    },
    onError: (error: Error) => {
      pushToast(
        error.message === 'PRINTER_IN_USE'
          ? 'Máy in vẫn đang được gán cho dịch vụ. Hãy bỏ gán trước khi xóa.'
          : `Lỗi xóa máy in: ${error.message}`,
        'error',
      )
    }
  })

  const testPrintMutation = useMutation({
    mutationFn: async (printer: Printer) => {
      if (!printer.printerId || !printer.ipAddress || (printer.type !== 1 && printer.type !== 2)) {
        throw new Error('In thử chỉ hỗ trợ máy in mạng POS 58/POS 80.')
      }
      const cafeInfo = await getCafeInfo()
      const payload = await renderPrinterHtml(
        printer.printerId,
        printer.type,
        printerHtmlTestTemplate(printer.printerName, printer.ipAddress, printer.type, cafeInfo),
      )
      return printBitmap(payload)
    },
    onSuccess: () => pushToast('Đã gửi phiếu in thử.', 'success'),
    onError: (error: Error) => pushToast(`Lỗi in thử: ${error.message}`, 'error'),
  })

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingPrinter?.printerName?.trim()) return
    saveMutation.mutate({
      printer: {
        printerId: editingPrinter.printerId,
        printerName: editingPrinter.printerName.trim(),
        type: editingPrinter.type ?? 1,
        active: editingPrinter.active ?? 1,
        ipAddress: editingPrinter.ipAddress?.trim() ?? '',
        port: editingPrinter.port && editingPrinter.port > 0 ? editingPrinter.port : 9100,
        hasCutter: editingPrinter.hasCutter ?? 1,
      },
      serviceIds:
        editingPrinter.printerId !== undefined && servicesQuery.isSuccess && !servicesQuery.isFetching
          ? assignedServiceIds
          : undefined,
    })
  }

  const handleAddDiscovered = (dp: DiscoveredPrinter) => {
    setEditingPrinter({
      printerName: dp.proposedName,
      ipAddress: dp.ipAddress || '',
      port: dp.port || 9100,
      type: discoveredType(dp.width),
      active: 0,
      hasCutter: dp.cutter ? 1 : 0,
    })
    setShowDiscover(false)
  }

  return (
    <section className="page-card" style={{ position: 'relative', display: 'flex', padding: 0, overflow: 'hidden', height: 'calc(100vh - 48px)' }}>
      
      {/* Main Content Area */}
      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <header className="page-header">
          <h2 className="title">Quản lý máy in</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              type="button"
              variant="secondary"
              loading={discoverMutation.isPending}
              onClick={() => {
                setShowDiscover(true)
                discoverMutation.mutate(undefined)
              }}
            >
              Tìm trong LAN
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setEditingPrinter({ printerName: '', type: 1, active: 1, ipAddress: '', port: 9100, hasCutter: 1 })}
            >
              Thêm máy in
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div>Đang tải danh sách máy in...</div>
        ) : (
          <div className="table-card" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="table data-table">
              <thead>
                <tr>
                  <th>Tên máy in</th>
                  <th>Địa chỉ IP</th>
                  <th>Loại/khổ giấy</th>
                  <th>Port</th>
                  <th>Trạng thái</th>
                  <th>Cutter</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {printers && printers.length > 0 ? printers.map((p, i) => (
                  <tr key={p.printerId ?? `printer-${i}`} style={editingPrinter?.printerId === p.printerId ? { backgroundColor: 'var(--bg-hover)' } : {}}>
                    <td>{p.printerName}</td>
                    <td>{p.ipAddress || 'USB / Driver máy chủ'}</td>
                    <td>{printerTypeLabel(p.type)}</td>
                    <td>{p.ipAddress ? p.port : '—'}</td>
                    <td>{p.active ? 'Đang sử dụng' : 'Tạm ngưng'}</td>
                    <td>{p.hasCutter ? 'Có' : 'Không'}</td>
                    <td>
                      <div className="printer-row-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditingPrinter(p)}
                      >
                        Sửa
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => testPrintMutation.mutate(p)}
                        disabled={testPrintMutation.isPending || !p.ipAddress || !p.active || p.type === 0}
                        title={p.type === 0 ? 'In thử hiện hỗ trợ máy in nhiệt POS 58/POS 80.' : !p.ipAddress ? 'In thử qua WebUI hiện hỗ trợ máy in mạng có địa chỉ IP.' : !p.active ? 'Máy in đang tạm ngưng.' : undefined}
                      >
                        In thử
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="printer-row-actions__delete"
                        onClick={() => {
                          if (confirm('Bạn có chắc muốn xóa máy in này?')) {
                            deleteMutation.mutate(p.printerId!)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        Xóa
                      </Button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center' }}>Không có máy in nào</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Context Action Panel (Sidebar) */}
      {editingPrinter && (
        <div style={{ 
          width: '420px',
          borderLeft: '1px solid var(--border)', 
          backgroundColor: 'var(--background)', 
          padding: '2rem 1.5rem',
          display: 'flex', 
          flexDirection: 'column',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.85em', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                {editingPrinter.printerId !== undefined ? 'Chỉnh sửa' : 'Tạo mới'}
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--primary)' }}>
                Máy In
              </h3>
            </div>
            <IconButton
              label="Đóng panel"
              icon={<X size={20} weight="bold" aria-hidden="true" />}
              onClick={() => setEditingPrinter(null)}
            />
          </div>
          
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Gom nhóm [nhãn | ô nhập/chọn] trên 1 khung — cùng kiểu "Loại nhóm" ở trang user-groups. */}
            <div className="ds-input-group">
              <label className="ds-input-group-separator" htmlFor="printer-name">Tên máy in</label>
              <input
                id="printer-name"
                className="ds-input"
                type="text"
                value={editingPrinter.printerName || ''}
                onChange={e => setEditingPrinter({...editingPrinter, printerName: e.target.value})}
                required
              />
            </div>
            <div className="printer-drawer__row">
              <div className="ds-input-group printer-drawer__paper">
                <label className="ds-input-group-separator" htmlFor="printer-type">Khổ giấy</label>
                <Select
                  id="printer-type"
                  className="ds-select"
                  value={editingPrinter.type ?? 1}
                  onChange={e => setEditingPrinter({ ...editingPrinter, type: Number(e.target.value) as Printer['type'] })}
                >
                  {PRINTER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </Select>
              </div>
              <label className="printer-drawer__check">
                <input
                  type="checkbox"
                  checked={editingPrinter.hasCutter === 1}
                  onChange={e => setEditingPrinter({...editingPrinter, hasCutter: e.target.checked ? 1 : 0})}
                />
                <span>Cắt giấy</span>
              </label>
            </div>
            <div className="printer-drawer__row">
              <div className="ds-input-group printer-drawer__ip">
                <label className="ds-input-group-separator" htmlFor="printer-ip">IP</label>
                <input
                  id="printer-ip"
                  className="ds-input"
                  type="text"
                  value={editingPrinter.ipAddress || ''}
                  onChange={e => setEditingPrinter({...editingPrinter, ipAddress: e.target.value})}
                  placeholder="Trống nếu dùng USB"
                />
              </div>
              <div className="ds-input-group printer-drawer__port" style={{ opacity: editingPrinter.ipAddress ? 1 : 0.55 }}>
                <label className="ds-input-group-separator" htmlFor="printer-port">Port</label>
                <input
                  id="printer-port"
                  className="ds-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={editingPrinter.port || 9100}
                  onChange={e => setEditingPrinter({...editingPrinter, port: Number(e.target.value)})}
                  disabled={!editingPrinter.ipAddress}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={(editingPrinter.active ?? 1) === 1}
                onChange={e => setEditingPrinter({...editingPrinter, active: e.target.checked ? 1 : 0})}
              />
              <label>Cho phép sử dụng</label>
            </div>

            {editingPrinter.printerId !== undefined ? (
              <fieldset className="printer-service-map">
                <legend>Dịch vụ gửi đến máy in</legend>
                {servicesQuery.isLoading ? <span>Đang tải danh mục dịch vụ…</span> : null}
                {servicesQuery.isError ? <span>Không tải được: {servicesQuery.error.message}</span> : null}
                {servicesQuery.data && servicesQuery.data.groups.length > 0 ? (
                  <SelectAllCheckbox
                    className="printer-service-map__all"
                    ids={servicesQuery.data.groups.flatMap((group) => group.services.map((service) => service.serviceId))}
                    selected={assignedServiceIds}
                    onToggle={(checked) => {
                      const allIds = servicesQuery.data!.groups.flatMap((group) => group.services.map((service) => service.serviceId))
                      setAssignedServiceIds(checked ? allIds : [])
                    }}
                  >
                    <strong>Chọn tất cả</strong>
                  </SelectAllCheckbox>
                ) : null}
                {servicesQuery.data?.groups.map((group) => (
                  <div key={group.groupId} className="printer-service-map__group">
                    <SelectAllCheckbox
                      ids={group.services.map((service) => service.serviceId)}
                      selected={assignedServiceIds}
                      onToggle={(checked) => {
                        const groupIds = group.services.map((service) => service.serviceId)
                        setAssignedServiceIds((current) =>
                          checked
                            ? [...new Set([...current, ...groupIds])]
                            : current.filter((id) => !groupIds.includes(id)),
                        )
                      }}
                    >
                      <strong>{group.groupName}</strong>
                    </SelectAllCheckbox>
                    {group.services.map((service) => (
                      <label key={service.serviceId}>
                        <input
                          type="checkbox"
                          checked={assignedServiceIds.includes(service.serviceId)}
                          onChange={(event) => setAssignedServiceIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, service.serviceId])]
                              : current.filter((id) => id !== service.serviceId),
                          )}
                        />
                        <span>{service.serviceName}{service.active ? '' : ' (tạm ngưng)'}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
            ) : null}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
              <div className="printer-drawer__row">
                <Button type="button" variant="secondary" block onClick={() => setEditingPrinter(null)}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  block
                  loading={saveMutation.isPending}
                  disabled={editingPrinter.printerId !== undefined && servicesQuery.isFetching}
                >
                  {editingPrinter.printerId !== undefined ? 'Cập nhật' : 'Thêm mới'}
                </Button>
              </div>
              {editingPrinter.printerId !== undefined && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    if (confirm('Bạn có chắc muốn xóa máy in này?')) {
                      deleteMutation.mutate(editingPrinter.printerId!)
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  Xóa máy in này
                </Button>
              )}
            </div>
          </form>
        </div>
      )}

      {showDiscover && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Kết quả dò tìm máy in</h3>
              <IconButton label="Đóng kết quả dò tìm" icon={<X size={20} weight="bold" aria-hidden="true" />} onClick={() => setShowDiscover(false)} />
            </div>
            {discoverMutation.isPending ? (
              <p>Đang quét mạng LAN và USB, vui lòng chờ...</p>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                {discoverMutation.data && discoverMutation.data.length > 0 ? (
                  <table className="table data-table">
                    <thead>
                      <tr>
                        <th>Loại</th>
                        <th>Model</th>
                        <th>IP/Port</th>
                        <th>Khổ giấy</th>
                        <th>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoverMutation.data.map((dp, i) => (
                        <tr key={i}>
                          <td>{dp.connection}</td>
                          <td>{dp.deviceName}</td>
                          <td>{dp.ipAddress ? `${dp.ipAddress}:${dp.port}` : 'Local USB'}</td>
                          <td>{dp.width}</td>
                          <td>
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() => handleAddDiscovered(dp)}
                            >
                              Thêm
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>Không tìm thấy máy in nào.</p>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button type="button" variant="secondary" onClick={() => setShowDiscover(false)}>Đóng</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

