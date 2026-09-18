import { BookMarked, Flame, TrendingUp, Trophy, type LucideIcon } from 'lucide-react'
import type { PublicationHonor } from '../../../shared/types'

export interface PublicationHonorDetail {
  id: PublicationHonor
  label: string
  shortLabel: string
  icon: LucideIcon
}

export const publicationHonorDetails: PublicationHonorDetail[] = [
  { id: 'esi-highly-cited', label: 'ESI 高被引论文', shortLabel: 'ESI 高被引', icon: TrendingUp },
  { id: 'esi-hot', label: 'ESI 热点论文', shortLabel: 'ESI 热点', icon: Flame },
  { id: 'cover-paper', label: '封面论文', shortLabel: '封面论文', icon: BookMarked },
  { id: 'best-paper', label: '最佳论文', shortLabel: '最佳论文', icon: Trophy }
]
