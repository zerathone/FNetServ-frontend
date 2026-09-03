import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkstationRuntime } from '../src/api/workstations.ts'
import {
  machinesInGroup,
  shutdownEpoch,
  systemFunctionName,
  validateShutdownSchedule,
} from '../src/features/workstations/phase2Model.ts'

test('system function resource IDs use the same labels as MFC resources', () => {
  assert.equal(systemFunctionName(20000), 'DOS Command Prompt')
  assert.equal(systemFunctionName(20015), 'Nút Start')
  assert.equal(systemFunctionName(29999), 'Chức năng hệ thống #29999')
})

test('shutdown schedule rejects an invalid or past one-time value', () => {
  assert.match(validateShutdownSchedule('once', '', '23:00', 1) ?? '', /chọn ngày giờ/)
  assert.match(
    validateShutdownSchedule('once', '2020-01-01T00:00', '23:00', Date.now()) ?? '',
    /tương lai/,
  )
  assert.equal(validateShutdownSchedule('off', '', '', Date.now()), null)
  assert.equal(validateShutdownSchedule('daily', '', '08:30', Date.now()), null)
})

test('daily shutdown converts the selected local time to epoch seconds', () => {
  const epoch = shutdownEpoch('daily', '', '08:30')
  assert.equal(typeof epoch, 'number')
  const date = new Date((epoch as number) * 1_000)
  assert.equal(date.getHours(), 8)
  assert.equal(date.getMinutes(), 30)
})

test('machine transfer source is filtered and naturally sorted', () => {
  const machines = [
    { hostName: 'PC-10', machineGroupId: 2 },
    { hostName: 'PC-2', machineGroupId: 2 },
    { hostName: 'PC-1', machineGroupId: 1 },
  ] as WorkstationRuntime[]
  assert.deepEqual(machinesInGroup(machines, 2).map((machine) => machine.hostName), ['PC-2', 'PC-10'])
})
