import { describe, expect, it } from 'vitest'
import { visualStyles, backgroundStyles, defaultInterfacePreferences } from '../src/shared/interface'
import { interfacePreferencesSchema, interfacePatchSchema } from '../src/domain/interface'
import { interfacePalette } from '../src/shared/palette'

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => { const channel = parseInt(hex.slice(i, i + 2), 16) / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4 })
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722
}
const contrast = (a: string, b: string) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0]! + .05) / (values[1]! + .05) }
describe('single workbench style', () => {
  it('reads legacy preferences without changing their background or type size', () => {
    const legacy: Partial<typeof defaultInterfacePreferences> = { ...defaultInterfacePreferences, background: 'orange', fontSize: 18 }
    delete legacy.visualStyle
    expect(interfacePreferencesSchema.parse(legacy)).toMatchObject({ visualStyle: 'classic', background: 'orange', fontSize: 18 })
    expect(interfacePatchSchema.safeParse({ visualStyle: 'unknown' }).success).toBe(false)
    expect(visualStyles).toEqual(['classic'])
    for (const removed of ['wilds', 'sky', 'forest', 'ink', 'cosmos']) {
      expect(interfacePreferencesSchema.parse({ ...legacy, visualStyle: removed })).toMatchObject({ visualStyle: 'classic', background: 'orange', fontSize: 18 })
      expect(interfacePatchSchema.safeParse({ visualStyle: removed }).success).toBe(false)
    }
  })
  it('keeps text and primary actions readable in every light and dark palette', () => {
    for (const dark of [false, true]) for (const background of backgroundStyles) {
      const p = interfacePalette(background, dark).variables
      for (const surface of ['--surface-solid', '--surface-inset', '--surface-raised'] as const) {
        expect(contrast(p['--text-primary'], p[surface]), `${background} primary ${dark}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p['--text-secondary'], p[surface]), `${background} secondary ${dark}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(p['--on-accent'], p['--accent']), `${background} action ${dark}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
