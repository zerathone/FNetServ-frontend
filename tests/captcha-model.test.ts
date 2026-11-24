import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CAPTCHA_ALPHABET,
  CAPTCHA_LENGTH,
  CAPTCHA_MAX_ATTEMPTS,
  attemptsLeft,
  generateCaptchaText,
  isCaptchaMatch,
} from '../src/features/customers/captchaModel.ts'

test('bảng ký tự: 32 ký tự, không có ký tự dễ nhầm 0 O 1 I', () => {
  assert.equal(CAPTCHA_ALPHABET.length, 32)
  for (const ch of '0O1I') assert.equal(CAPTCHA_ALPHABET.includes(ch), false)
  assert.equal(new Set(CAPTCHA_ALPHABET).size, 32)
})

test('generateCaptchaText: đúng độ dài, chỉ gồm ký tự trong bảng', () => {
  for (let run = 0; run < 200; run += 1) {
    const text = generateCaptchaText()
    assert.equal(text.length, CAPTCHA_LENGTH)
    for (const ch of text) assert.ok(CAPTCHA_ALPHABET.includes(ch), `ký tự lạ: ${ch}`)
  }
})

test('generateCaptchaText: ánh xạ byte % 32 theo thứ tự (nguồn ngẫu nhiên tiêm được)', () => {
  assert.equal(generateCaptchaText(() => [0, 1, 2, 3, 4]), 'ABCDE')
  // 32→0 (A), 33→1 (B), 63/255/31→31 (9): byte vượt 31 quay vòng.
  assert.equal(generateCaptchaText(() => [32, 33, 63, 255, 31]), 'AB999')
})

test('isCaptchaMatch: không phân biệt hoa thường, bỏ khoảng trắng, chặn rỗng', () => {
  assert.equal(isCaptchaMatch('AB2CD', 'ab2cd'), true)
  assert.equal(isCaptchaMatch('AB2CD', '  A B 2 C D '), true)
  assert.equal(isCaptchaMatch('AB2CD', 'AB2CE'), false)
  assert.equal(isCaptchaMatch('AB2CD', ''), false)
  assert.equal(isCaptchaMatch('AB2CD', '   '), false)
})

test('attemptsLeft: đếm ngược đến 0, không âm', () => {
  assert.equal(CAPTCHA_MAX_ATTEMPTS, 3)
  assert.equal(attemptsLeft(0), 3)
  assert.equal(attemptsLeft(1), 2)
  assert.equal(attemptsLeft(3), 0)
  assert.equal(attemptsLeft(9), 0)
})
