import type { BackgroundStyle } from './interface'

const seeds: Record<BackgroundStyle, [number, number]> = {
  default: [203, 16], mist: [224, 24], sage: [151, 22], dusk: [290, 19],
  midnight: [223, 22], klein: [229, 52], orange: [27, 34], yellow: [46, 34],
  red: [4, 28], pink: [333, 29], custom: [203, 16]
}
const companionHues: Record<BackgroundStyle, number> = {
  default: 157, mist: 160, sage: 212, dusk: 186, midnight: 153, klein: 164,
  orange: 208, yellow: 201, red: 211, pink: 192, custom: 157
}
export function hslHex(hue: number, saturation: number, lightness: number) {
  const a = saturation / 100 * Math.min(lightness / 100, 1 - lightness / 100)
  return '#' + [0, 8, 4].map(offset => {
    const k = (offset + hue / 30) % 12
    const value = lightness / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value).toString(16).padStart(2, '0')
  }).join('')
}
export function interfacePalette(style: BackgroundStyle, dark: boolean, custom?: [number, number]) {
  const [hue, saturation] = custom ?? seeds[style]
  const color = (light: number, strength = 1) => hslHex(hue, saturation * strength, light)
  const base = color(dark ? 13 : 91)
  const solid = color(dark ? 19 : 98, 0.7)
  const secondary = color(dark ? 24 : 92, 0.75)
  const text = color(dark ? 94 : 16, 0.45)
  const accent = color(dark ? 78 : 32, 1.35)
  const companionHue = custom ? (hue + 58) % 360 : companionHues[style]
  const companion = (light: number) => hslHex(companionHue, Math.min(42, saturation + 12), light)
  const warm = (light: number) => hslHex(style === 'yellow' ? 29 : 35, 38, light)
  const positive = (light: number) => hslHex(153, 27, light)
  return {
    base, text,
    variables: {
      '--app-background': base, '--chrome-color': base,
      '--surface-primary': solid, '--surface-solid': solid, '--surface-secondary': secondary,
      '--surface-workspace': color(dark ? 16 : 95, 0.8),
      '--surface-raised': color(dark ? 23 : 99, 0.75), '--surface-inset': color(dark ? 13 : 91, 0.85),
      '--surface-hover': color(dark ? 28 : 88, 0.75),
      '--surface-feature': color(dark ? 22 : 97, 1),
      '--surface-companion': companion(dark ? 21 : 97), '--surface-warm': warm(dark ? 21 : 97),
      '--action-companion': companion(dark ? 79 : 30), '--on-companion': companion(dark ? 13 : 99),
      '--action-warm': warm(dark ? 79 : 31), '--on-warm': warm(dark ? 13 : 99),
      '--action-positive': positive(dark ? 79 : 30), '--on-positive': positive(dark ? 13 : 99),
      '--companion-soft': companion(dark ? 79 : 30) + '1c',
      '--warm-soft': warm(dark ? 79 : 31) + '1c', '--positive-soft': positive(dark ? 79 : 30) + '1c',
      '--glass-highlight': color(dark ? 90 : 100, 0.35) + (dark ? '30' : 'b8'),
      '--glass-shade': color(dark ? 3 : 24, 0.9) + (dark ? '48' : '18'),
      '--shadow-ink': color(dark ? 2 : 21, 0.7),
      '--glass-sidebar': solid + 'ef', '--glass-dock': solid + 'f0', '--glass-dialog': solid + 'fa',
      '--glass-floating': solid + 'f2', '--glass-card': solid + 'f2',
      '--text-primary': text, '--text-secondary': color(dark ? 78 : 35, 0.45),
      '--text-muted': color(dark ? 71 : 37, 0.4), '--accent': accent,
      '--accent-hover': color(dark ? 86 : 26, 1.2), '--accent-soft': accent + '22',
      '--on-accent': color(dark ? 14 : 99, 0.4),
      '--border-default': color(dark ? 75 : 35, 0.4) + '38',
      '--border-subtle': color(dark ? 75 : 35, 0.4) + '1a',
      '--border-elevated': color(dark ? 75 : 35, 0.4) + '55'
    }
  }
}
