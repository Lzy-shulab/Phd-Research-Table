import { z } from 'zod'
import { backgroundStyles } from '../shared/interface'

const fields = {
  panelOpacity: z.number().int().min(20).max(100),
  background: z.enum(backgroundStyles),
  fontSize: z.union([z.literal(13), z.literal(14), z.literal(16), z.literal(18)])
}
export const interfacePatchSchema = z.object(fields).partial().strict()
export const interfacePreferencesSchema = z.object({
  ...fields,
  panelOpacity: fields.panelOpacity.default(75),
  backgroundFile: z.string().regex(/^[a-f0-9]{64}\.jpg$/).nullable(),
  backgroundName: z.string().max(255)
}).strict()
