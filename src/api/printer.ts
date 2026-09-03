import { apiGet, apiPost, apiPut } from './client'

export type Printer = {
  printerId?: number
  printerName: string
  type: 0 | 1 | 2
  active: 0 | 1
  ipAddress: string
  port: number
  hasCutter: 0 | 1
}

export async function getPrinters() {
  return apiPost<Printer[], void>('/printer/list', undefined)
}

export async function savePrinter(printer: Printer) {
  return apiPost<void, Printer>('/printer/save', printer)
}

export async function deletePrinter(printerId: number) {
  return apiPost<void, { printerId: number }>('/printer/delete', { printerId })
}

export type PrinterService = {
  serviceId: number
  serviceName: string
  active: boolean | 0 | 1
  assigned: boolean
}

export type PrinterServiceGroup = {
  groupId: number
  groupName: string
  services: PrinterService[]
}

export type PrinterServicesCatalog = {
  printerId: number
  groups: PrinterServiceGroup[]
}

export async function getPrinterServices(printerId: number) {
  return apiGet<PrinterServicesCatalog>(`/printer/services?printerId=${printerId}`)
}

export async function savePrinterServices(printerId: number, serviceIds: number[]) {
  return apiPut<{ printerId: number; assignedCount: number }, { printerId: number; serviceIds: number[] }>(
    '/printer/services',
    { printerId, serviceIds },
  )
}

export type DiscoveredPrinter = {
  connection: string
  width: string
  cutter: number
  ipAddress: string
  port: number
  deviceName: string
  manufacturer: string
  proposedName: string
}

export async function discoverPrinters(subnet?: string) {
  return apiPost<DiscoveredPrinter[], { subnet?: string }>('/printer/discover', { subnet })
}

export type PrinterBitmapPayload = {
  printerId: number
  width: 384 | 576
  height: number
  bitmap: string
}

export async function printBitmap(payload: PrinterBitmapPayload) {
  return apiPost<void, PrinterBitmapPayload>('/printer/print', payload)
}
