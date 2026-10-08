import { z } from 'zod'
import { backgroundStyles, visualStyles } from '../shared/interface'

const fields = {
  visualStyle: z.enum(visualStyles),
  panelOpacity: z.number().int().min(20).max(100),
  background: z.enum(backgroundStyles),
  fontSize: z.union([z.literal(13), z.literal(14), z.literal(16), z.literal(18)]),
  compactMode: z.boolean(),
  sidebarCollapsed: z.boolean(),
  encouragementHidden: z.boolean(),
  dockAutoHide: z.boolean(),
  plannerDisplay: z.enum(['notes', 'list']),
  literatureDisplay: z.enum(['cards', 'list']),
  publicationDisplay: z.enum(['bookcase', 'list'])
}
export const interfacePatchSchema = z.object(fields).partial().strict()
export const interfacePreferencesSchema = z.object({
  ...fields,
  visualStyle: z.preprocess(value => ['wilds', 'sky', 'forest', 'ink', 'cosmos'].includes(String(value)) ? 'classic' : value, fields.visualStyle.default('classic')),
  panelOpacity: fields.panelOpacity.default(75),
  compactMode: fields.compactMode.default(false),
  sidebarCollapsed: fields.sidebarCollapsed.default(false),
  encouragementHidden: fields.encouragementHidden.default(false),
  dockAutoHide: fields.dockAutoHide.default(false),
  plannerDisplay: fields.plannerDisplay.default('list'),
  literatureDisplay: fields.literatureDisplay.default('cards'),
  publicationDisplay: fields.publicationDisplay.default('bookcase'),
  backgroundFile: z.string().regex(/^[a-f0-9]{64}\.jpg$/).nullable(),
  backgroundName: z.string().max(255)
}).strict()
