import type { ArxivSettings } from './types'

export const defaultArxivSettings: ArxivSettings = {
  enabled: true, daysBack: 14, maxPerDay: 5,
  directions: [
    'hyperspectral image', 'hyperspectral remote sensing', 'hyperspectral reconstruction',
    'hyperspectral fusion', 'hyperspectral super-resolution', 'hyperspectral denoising',
    'Mamba AND remote sensing', 'Mamba AND hyperspectral', 'Mamba AND computer vision',
    'state space model AND remote sensing', 'state space model AND computer vision',
    'multimodal object detection', 'multi-modal object detection', 'visible infrared object detection',
    'RGB-T object detection', 'remote sensing object detection', 'multimodal remote sensing', 'SAR-optical AND detection'
  ]
}
export const paperMetadataDefaults = {
  collection: 'library' as const, arxivId: null, abstract: '', doi: '', publishedDate: '',
  collectedDate: '', casPartition: '', jcrQuartile: '', honors: [], readProgress: 0,
  metadataStatus: 'pending' as const, metadataSource: '', metadataMessage: '', metadataCheckedAt: null, metadataLockedFields: '[]'
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
