import type { PublicationInput, PublicationMetadataPreview } from '../shared/types'

export const publicationMetadataKeys = ['title', 'authors', 'journal', 'publishedDate', 'doi'] as const
export function mergePublicationMetadata(current: PublicationInput, fields: PublicationMetadataPreview['fields'], protectedFields: ReadonlySet<keyof PublicationInput>) {
  const next = { ...current }
  for (const key of publicationMetadataKeys) if (!protectedFields.has(key) && fields[key]) next[key] = fields[key]
  return next
}
