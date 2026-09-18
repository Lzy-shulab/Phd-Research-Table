import { useEffect } from 'react'
import { useLibrary } from '../../stores/library'
import { requestMetadata } from '../../lib/metadata'

export function MetadataQueue() {
  const papers = useLibrary((state) => state.papers)
  const automatic = useLibrary((state) => state.metadataAutomatic)
  useEffect(() => {
    if (!automatic) return
    for (const paper of papers) if (paper.collection === 'library' && paper.metadataStatus === 'pending') void requestMetadata(paper)
  }, [papers, automatic])
  return null
}
