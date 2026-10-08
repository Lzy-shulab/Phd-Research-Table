import { describe, expect, it } from 'vitest'
import { mergeHighlightRects } from '../src/renderer/lib/highlights'

describe('PDF sentence highlighting', () => {
  it('joins duplicated and adjacent word fragments into one line without changing saved input', () => {
    const fragments = [
      { x: 0.1, y: 0.2, width: 0.04, height: 0.016 },
      { x: 0.1, y: 0.2, width: 0.04, height: 0.016 },
      { x: 0.145, y: 0.201, width: 0.05, height: 0.015 },
      { x: 0.196, y: 0.2, width: 0.06, height: 0.016 }
    ]
    const original = structuredClone(fragments)
    const lines = mergeHighlightRects(fragments)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.x).toBe(0.1)
    expect(lines[0]!.width).toBeCloseTo(0.156)
    expect(fragments).toEqual(original)
  })

  it('keeps separate lines and PDF columns as separate geometry', () => {
    const lines = mergeHighlightRects([
      { x: 0.1, y: 0.2, width: 0.3, height: 0.015 },
      { x: 0.1, y: 0.22, width: 0.3, height: 0.015 },
      { x: 0.47, y: 0.2, width: 0.3, height: 0.015 }
    ])
    expect(lines).toHaveLength(3)
    expect(lines.map(rect => rect.width)).toEqual([0.3, 0.3, 0.3])
  })

  it('merges a legacy whole-line rectangle and its nested range rectangles once', () => {
    const lines = mergeHighlightRects([
      { x: 0.11, y: 0.3, width: 0.03, height: 0.014 },
      { x: 0.2, y: 0.3, width: 0.05, height: 0.014 },
      { x: 0.1, y: 0.298, width: 0.3, height: 0.018 }
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]!.width).toBeCloseTo(0.3)
    expect(lines[0]!.height).toBeCloseTo(0.018)
  })
})
