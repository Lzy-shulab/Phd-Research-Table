import type { PaperHighlightRect } from '../../shared/types'

/** Join browser range fragments on the same text line, keeping column gaps intact. */
export function mergeHighlightRects(rects: readonly PaperHighlightRect[]): PaperHighlightRect[] {
  const lines: PaperHighlightRect[] = []
  for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let merged = { ...rect }
    for (let index = 0; index < lines.length;) {
      const line = lines[index]!
      const overlap = Math.min(line.y + line.height, merged.y + merged.height) - Math.max(line.y, merged.y)
      const gap = Math.max(line.x, merged.x) - Math.min(line.x + line.width, merged.x + merged.width)
      const sameLine = overlap >= Math.min(line.height, merged.height) * 0.5
      const adjacent = gap <= Math.min(0.012, Math.max(line.height, merged.height) * 0.6)
      if (!sameLine || !adjacent) { index++; continue }
      const x = Math.min(line.x, merged.x), y = Math.min(line.y, merged.y)
      merged = { x, y, width: Math.max(line.x + line.width, merged.x + merged.width) - x, height: Math.max(line.y + line.height, merged.y + merged.height) - y }
      lines.splice(index, 1)
      index = 0
    }
    lines.push(merged)
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x)
}
