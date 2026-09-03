import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { getPrinters, deletePrinter, discoverPrinters, getPrinterServices, printBitmap, savePrinter, savePrinterServices, type Printer, type DiscoveredPrinter } from '../api/printer'
import { getCafeInfo } from '../api/settings'
import { printerHtmlTestTemplate, renderPrinterHtml } from '../features/printers/browserHtmlRaster'
import { pushToast } from '../store/toast'
import { Button, IconButton, Select } from '../design-system/components';
import './printer-settings.css'

const PRINTER_TYPES: Array<{ value: Printer['type']; label: string }> = [
  { value: 0, label: 'A4' },
  { value: 1, label: 'POS 80 (576 dots)' },
  { value: 2, label: 'POS 58 (384 dots)' },
]

function printerTypeLabel(type: Printer['type']) {
  return PRINTER_TYPES.find((item) => item.value === type)?.label ?? `Loại ${type}`
}

function discoveredType(width: string): Printer['type'] {
  if (width.toUpperCase() === 'K80') return 1
  if (width.toUpperCase() === 'K58') return 2
  return 0
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

  const serviceMutation = useMutation({
    mutationFn: () => savePrinterServices(editingPrinter!.printerId!, assignedServiceIds),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['printer-services', editingPrinter?.printerId] })
      pushToast(`Đã gán ${result.assignedCount} dịch vụ cho máy in.`, 'success')
    },
    onError: (error: Error) => pushToast(`Lỗi lưu dịch vụ: ${error.message}`, 'error'),
  })

  const discoverMutation = useMutation({
    mutationFn: discoverPrinters,
    onError: (error: Error) => {
      pushToast(`Lỗi dò tìm: ${error.message}`, 'error')
    }
  })

  const saveMutation = useMutation({
    mutationFn: savePrinter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['printers'] })
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
      printerId: editingPrinter.printerId,
      printerName: editingPrinter.printerName.trim(),
      type: editingPrinter.type ?? 1,
      active: editingPrinter.active ?? 1,
      ipAddress: editingPrinter.ipAddress?.trim() ?? '',
      port: editingPrinter.port && editingPrinter.port > 0 ? editingPrinter.port : 9100,
      hasCutter: editingPrinter.hasCutter ?? 1,
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
              Dò tìm máy in (Scan)
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
                  <th>ID</th>
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
                    <td>{p.printerId}</td>
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
                        variant="danger"
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
                    <td colSpan={8} style={{ textAlign: 'center' }}>Không có máy in nào</td>
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
          width: '320px', 
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
            <div className="field compact-field">
              <label>Tên máy in</label>
              <input 
                type="text" 
                value={editingPrinter.printerName || ''}
                onChange={e => setEditingPrinter({...editingPrinter, printerName: e.target.value})}
                required
              />
            </div>
            <div className="field compact-field">
              <label>Loại máy in / khổ giấy</label>
              <Select
                value={editingPrinter.type ?? 1}
                onChange={e => setEditingPrinter({ ...editingPrinter, type: Number(e.target.value) as Printer['type'] })}
              >
                {PRINTER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </Select>
            </div>
            <div className="field compact-field">
              <label>Địa chỉ IP</label>
              <input
                type="text"
                value={editingPrinter.ipAddress || ''}
                onChange={e => setEditingPrinter({...editingPrinter, ipAddress: e.target.value})}
                placeholder="Để trống nếu dùng USB / Windows Driver"
              />
            </div>
            <div className="field compact-field" style={{ opacity: editingPrinter.ipAddress ? 1 : 0.55 }}>
              <label>Port TCP</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={editingPrinter.port || 9100}
                onChange={e => setEditingPrinter({...editingPrinter, port: Number(e.target.value)})}
                disabled={!editingPrinter.ipAddress}
              />
            </div>
            <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-raised)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {editingPrinter.ipAddress
                ? 'Máy in mạng: Qt dựng HTML, raster hóa theo khổ giấy rồi gửi bitmap ESC/POS qua máy chủ.'
                : 'Máy in USB: Qt in trực tiếp qua Windows Driver; WebUI chỉ quản lý cấu hình.'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
              <input 
                type="checkbox" 
                checked={editingPrinter.hasCutter === 1}
                onChange={e => setEditingPrinter({...editingPrinter, hasCutter: e.target.checked ? 1 : 0})}
              />
              <label>Có dao cắt giấy (Cutter)</label>
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
                {servicesQuery.data?.groups.map((group) => (
                  <div key={group.groupId} className="printer-service-map__group">
                    <strong>{group.groupName}</strong>
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
                <Button
                  type="button"
                  variant="secondary"
                  loading={serviceMutation.isPending}
                  disabled={servicesQuery.isLoading}
                  onClick={() => serviceMutation.mutate()}
                >
                  {serviceMutation.isPending ? 'Đang lưu…' : 'Lưu dịch vụ được gán'}
                </Button>
              </fieldset>
            ) : null}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
              <Button type="button" variant="secondary" onClick={() => setEditingPrinter(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" loading={saveMutation.isPending}>
                {editingPrinter.printerId !== undefined ? 'Cập nhật' : 'Thêm mới'}
              </Button>
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

