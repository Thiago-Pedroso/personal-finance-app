import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contrastRatio, derivedAccent, mixColors, readableAccent, taxonomyChipStyle,
  validHexColor,
} from './colors.js'

test('readableAccent reaches AA contrast on chip backgrounds', () => {
  for (const accent of ['#008300', '#2a78d6', '#eb6834', '#e87ba4']) {
    const background = mixColors('#232b36', accent, 0.1)
    assert.ok(contrastRatio(readableAccent(accent), background) >= 4.5)
  }
})

test('derivedAccent is stable and distinguishes identities', () => {
  const salaryColor = derivedAccent('#008300', 'Renda:Salário')
  assert.equal(salaryColor, derivedAccent('#008300', 'Renda:Salário'))
  assert.notEqual(salaryColor, derivedAccent('#008300', 'Renda:Freelance'))
})

test('taxonomyChipStyle preserves the stored accent in the background', () => {
  const style = taxonomyChipStyle('#008300')
  assert.equal(style.background, '#0083001a')
  assert.equal(style.borderColor, `${style.color}88`)
  assert.equal(validHexColor('invalid'), '#8a97a6')
})
