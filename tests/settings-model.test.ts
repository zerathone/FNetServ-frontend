import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_RETENTION_SETTINGS, validateSystemSettings } from '../src/features/settings/settingsModel.ts'

const validInput = {
  retention: DEFAULT_RETENTION_SETTINGS,
  roundingUnit: 1_000,
  priceMin: 5_000,
  priceMinForMember: 2_000,
  userDeductPriceMin: 1_000,
}

test('system settings accept the API boundaries, including zero retention to disable cleanup', () => {
  assert.equal(validateSystemSettings({
    ...validInput,
    retention: { ...validInput.retention, systemLogDays: 0, serverLogRecords: 99_999 },
  }), null)
})

test('system settings preserve live handler validation constraints', () => {
  assert.match(validateSystemSettings({ ...validInput, roundingUnit: 501 }) ?? '', /số chẵn/)
  assert.match(validateSystemSettings({ ...validInput, priceMin: 1_000_000 }) ?? '', /999.999/)
  assert.match(validateSystemSettings({
    ...validInput,
    retention: { ...validInput.retention, warningLogDays: 10_000 },
  }) ?? '', /9.999/)
})
