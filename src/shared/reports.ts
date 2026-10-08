export type GoalMetric = 'papers' | 'tasks' | 'submissions' | 'publications' | 'checkinMinutes'
export type ReportGoals = Record<GoalMetric, number>
export interface ReportSettings {
  projectIds: string[]
  includeUnassigned: boolean
  projectsConfigured: boolean
  goals: { week: ReportGoals; month: ReportGoals }
}
export const emptyGoals: ReportGoals = { papers: 0, tasks: 0, submissions: 0, publications: 0, checkinMinutes: 0 }
export const defaultReportSettings: ReportSettings = { projectIds: [], includeUnassigned: false, projectsConfigured: false,
  goals: { week: { ...emptyGoals }, month: { ...emptyGoals } } }
export interface StipendEntry { id: string; receivedOn: string; amountCents: number; source: string; notes: string; createdAt: string }
export type StipendInput = Omit<StipendEntry, 'id' | 'createdAt'>
export interface CheckinEntry {
  id: string; date: string; durationMinutes: number; notes: string; createdAt: string
  startTime?: string; endTime?: string; endsNextDay?: boolean
}
export interface CheckinInput { date: string; startTime: string; endTime: string; endsNextDay: boolean; notes: string }
export interface ReportSnapshot { settings: ReportSettings; stipends: StipendEntry[]; readingDates: Record<string, string>; checkins: CheckinEntry[] }
