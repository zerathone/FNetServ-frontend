import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkstationRuntime } from '../src/api/workstations.ts'
import {
  WORKSTATION_FLAGS,
  WORKSTATION_STATUS,
  getWinLicenseView,
  getWorkstationStatus,
  interpolateSession,
  matchesWorkstationFilter,
} from '../src/features/workstations/workstationModel.ts'

function machine(
  patch: Partial<WorkstationRuntime> = {},
): WorkstationRuntime {
  return {
    hostName: 'PC-01',
    ip: '192.168.1.10',
    status: WORKSTATION_STATUS.ONLINE,
    flagMask: 0,
    version: '1.0',
    machineGroupId: 1,
    machineGroupName: 'Khu A',
    userId: 42,
    userName: 'member01',
    userGroupType: 1,
    note: null,
    lockLogin: false,
    session: {
      sessionId: 10,
      loginType: 1,
      prepaid: true,
      startedAt: '2026-07-30 10:00:00',
      usedSeconds: 60,
      remainingSeconds: 120,
      totalAmount: 5000,
      remainingMoney: 20000,
      comboName: null,
    },
    winLicense: null,
    updatedAtMs: 1,
    ...patch,
  }
}

test('running session clock advances locally without changing server money', () => {
  const result = interpolateSession(machine(), 15.9)
  assert.deepEqual(result, { used: 75, remaining: 105 })
})

test('paused and warning sessions keep the snapshot clock', () => {
  const paused = machine({ flagMask: WORKSTATION_FLAGS.CLIENT_PAUSE })
  const warning = machine({ status: WORKSTATION_STATUS.WARNING })
  assert.deepEqual(interpolateSession(paused, 30), { used: 60, remaining: 120 })
  assert.deepEqual(interpolateSession(warning, 30), { used: 60, remaining: 120 })
})

test('operational filters keep debt separate from connected default', () => {
  const connectedDebt = machine({ flagMask: WORKSTATION_FLAGS.HAVE_NOT_PAID })
  const disconnected = machine({ status: WORKSTATION_STATUS.DISCONNECT })
  assert.equal(matchesWorkstationFilter(connectedDebt, 'connected'), true)
  assert.equal(matchesWorkstationFilter(connectedDebt, 'debt'), true)
  assert.equal(matchesWorkstationFilter(disconnected, 'connected'), false)
  assert.equal(matchesWorkstationFilter(disconnected, 'disconnected'), true)
})

test('ADMIN and held-machine labels take priority over generic online status', () => {
  assert.equal(getWorkstationStatus(machine({ userId: 0 })).label, 'ADMIN')
  assert.equal(getWorkstationStatus(machine({ lockLogin: true })).label, 'Giữ máy')
})

test('missing windows license data yields no view at all (cell stays blank)', () => {
  // Khong co du lieu KHAC HAN status 0. Tra ve nhan bat ky o day la nhan vien se doc
  // thanh "may chua kich hoat Windows" tren nhung may chi don gian la chay client cu.
  assert.equal(getWinLicenseView(machine()), null)
})

test('licensed windows exposes label and partial key', () => {
  const view = getWinLicenseView(
    machine({ winLicense: { status: 1, pkey: '78RTG', channel: 'OEM:DM', graceMinutes: null } }),
  )
  assert.equal(view?.label, 'Đã kích hoạt')
  assert.equal(view?.tone, 'success')
  assert.equal(view?.pkey, '78RTG')
  assert.equal(view?.graceText, null)
})

test('grace period only shows remaining time for grace statuses', () => {
  // 4320 phut = 3 ngay. Status 2 (OOB Grace) co y nghia -> hien.
  const grace = getWinLicenseView(
    machine({ winLicense: { status: 2, pkey: 'ABCDE', channel: 'Volume:GVLK', graceMinutes: 4320 } }),
  )
  assert.equal(grace?.graceText, 'Còn 3 ngày')

  // Retail perpetual da activate tra ve 0 -- KHONG duoc hien "het han".
  const perpetual = getWinLicenseView(
    machine({ winLicense: { status: 1, pkey: 'ABCDE', channel: 'Retail', graceMinutes: 0 } }),
  )
  assert.equal(perpetual?.graceText, null)
})
