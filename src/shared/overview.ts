export interface PaperOverview {
  titleZh: string
  abstractZh: string
  generatedAt: string
  sourceAbstract: string
}

export interface PaperOverviewRequest {
  id: string
  sourceAbstract?: string
  regenerate?: boolean
}
