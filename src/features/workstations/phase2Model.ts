import type { WorkstationRuntime } from '../../api/workstations.ts'

export type ShutdownMode = 'off' | 'once' | 'daily'

export const SYSTEM_FUNCTION_NAMES: Record<number, string> = {
  20000: 'DOS Command Prompt',
  20001: 'Windows Task Manager',
  20002: 'Registry Editor',
  20003: 'Group Policy',
  20004: 'System Configuration Utility',
  20005: 'Biểu tượng trên Desktop',
  20006: 'Control Panel',
  20007: 'Computer Management',
  20008: 'Display Properties',
  20009: 'User Account',
  20010: 'Add Or Remove Programs',
  20011: 'Automatic Updates',
  20012: 'Windows Security Center',
  20013: 'Windows Firewall',
  20014: 'System Properties',
  20015: 'Nút Start',
}

export function systemFunctionName(resourceId: number) {
  return SYSTEM_FUNCTION_NAMES[resourceId] ?? `Chức năng hệ thống #${resourceId}`
}

export function toLocalDateTimeInput(epochSeconds: number) {
  if (!epochSeconds) return ''
  const date = new Date(epochSeconds * 1_000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function toLocalTimeInput(epochSeconds: number) {
  if (!epochSeconds) return '23:00'
  const date = new Date(epochSeconds * 1_000)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function shutdownEpoch(mode: ShutdownMode, onceAt: string, dailyAt: string) {
  if (mode === 'off') return undefined
  if (mode === 'once') {
    const value = new Date(onceAt).getTime()
    return Number.isFinite(value) ? Math.floor(value / 1_000) : undefined
  }

  const match = /^(\d{2}):(\d{2})$/.exec(dailyAt)
  if (!match) return undefined
  const date = new Date()
  date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  return Math.floor(date.getTime() / 1_000)
}

export function validateShutdownSchedule(
  mode: ShutdownMode,
  onceAt: string,
  dailyAt: string,
  nowMs = Date.now(),
) {
  const at = shutdownEpoch(mode, onceAt, dailyAt)
  if (mode === 'off') return null
  if (!at) return mode === 'once' ? 'Hãy chọn ngày giờ tắt máy.' : 'Hãy chọn giờ tắt máy hằng ngày.'
  if (mode === 'once' && at * 1_000 <= nowMs) return 'Thời điểm tắt một lần phải ở tương lai.'
  return null
}

export function machinesInGroup(machines: WorkstationRuntime[], groupId: number) {
  return machines
    .filter((machine) => machine.machineGroupId === groupId)
    .sort((left, right) => left.hostName.localeCompare(right.hostName, 'vi', { numeric: true }))
}
