import { describe, expect, it } from 'vitest'
import { backgroundStyles } from '../src/shared/interface'
import { interfacePalette } from '../src/shared/palette'

function contrast(first: string, second: string) {
  const luminance = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
describe('Background palette readability', () => {
  it('keeps content and action text readable in every built-in light and dark palette', () => {
    for (const background of backgroundStyles) for (const dark of [false, true]) {
      const { variables } = interfacePalette(background, dark)
      for (const surface of ['--surface-workspace', '--surface-raised', '--surface-inset'] as const)
        for (const text of ['--text-primary', '--text-secondary', '--text-muted'] as const)
          expect(contrast(variables[text], variables[surface]), `${background}/${dark}/${text}/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(variables['--on-accent'], variables['--accent']), `${background}/${dark}/primary-action`).toBeGreaterThanOrEqual(4.5)
      for (const role of ['companion', 'warm', 'positive'] as const) {
        expect(contrast(variables[`--on-${role}`], variables[`--action-${role}`]), `${background}/${dark}/${role}-action`).toBeGreaterThanOrEqual(4.5)
        if (role !== 'positive') {
          expect(contrast(variables[`--action-${role}`], variables[`--surface-${role}`]), `${background}/${dark}/${role}-label`).toBeGreaterThanOrEqual(4.5)
          expect(contrast(variables['--text-secondary'], variables[`--surface-${role}`]), `${background}/${dark}/${role}-body`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})
