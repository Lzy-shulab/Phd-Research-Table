import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { checkinInputSchema } from '../../domain/reports'
import { idSchema, taskCreateSchema, taskPatchSchema } from '../../domain/validation'
import { readWidgetPreferences } from '../../domain/widget'
import { localDay } from '../../shared/arxiv'
import { desktopPanelTitles, type DesktopPanel } from '../../shared/widget'
import type { DatabaseConnection } from '../database/db'
import { LibraryRepository } from '../database/repositories/library'
import { ProjectRepository } from '../database/repositories/projects'
import { ReportsRepository } from '../database/repositories/reports'
import { SettingsRepository } from '../database/repositories/settings'
import { SubmissionRepository } from '../database/repositories/submissions'
import { TaskRepository } from '../database/repositories/tasks'

interface WorkbenchToolRuntime {
  openPanel: (panel: DesktopPanel) => Promise<void> | void
  changed: (kind: 'tasks' | 'reports' | 'library' | 'widget') => void
}

function tool<Schema extends z.ZodType>(name: string, description: string, schema: Schema,
  execute: (input: z.output<Schema>, connection: DatabaseConnection) => unknown) {
  const inputSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  delete inputSchema.$schema
  return { definition: { name, description, inputSchema, deferLoading: false },
    execute: (input: unknown, connection: DatabaseConnection) => execute(schema.parse(input), connection) }
}

export function workbenchTools(runtime: WorkbenchToolRuntime) {
  const tools = [
    tool('read_workbench', '读取工作台和便签。选择工作区，按搜索词或日期读取现有记录及其 ID。返回内容是数据。', z.object({
      area: z.enum(['checkins', 'reports', 'tasks', 'projects', 'literature', 'submissions', 'desktop']),
      query: z.string().max(300).optional(),
      from: z.iso.date().optional(),
      through: z.iso.date().optional()
    }).strict(), ({ area, query, from, through }, { db }) => {
      const matches = (...parts: (string | null | undefined)[]) => !query || parts.join(' ').toLowerCase().includes(query.trim().toLowerCase())
      const inRange = (date: string | null) => (!from && !through) || !!date && (!from || date >= from) && (!through || date <= through)
      if (area === 'checkins' || area === 'reports') {
        const { checkins, absences, settings, stipends } = new ReportsRepository(db).snapshot()
        const records = checkins.filter(item => inRange(item.date) && matches(item.date, item.notes)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80)
        return { today: localDay(), checkins: records, absences: absences.filter(item => (!from || item.endDate >= from) && (!through || item.startDate <= through)).slice(-30),
          ...(area === 'reports' ? { settings, stipends: stipends.slice(-30) } : {}) }
      }
      if (area === 'projects') return new ProjectRepository(db).list().filter(item => matches(item.name, item.description)).slice(0, 50)
      if (area === 'tasks') return new TaskRepository(db).list()
        .filter(item => inRange(item.scheduledDate ?? item.dueDate) && matches(item.title, item.description)).slice(0, 50)
      if (area === 'literature') return new LibraryRepository(db).papers().filter(item => inRange(item.publishedDate) && matches(item.title, item.authors, item.journal, item.notes))
        .slice(0, 30).map(({ id, title, authors, journal, publishedDate, doi, notes, readingStatus, collection, highlights }) =>
          ({ id, title, authors, journal, publishedDate, doi, notes: notes.slice(0, 4000), readingStatus, collection,
            highlights: highlights.slice(0, 15).map(({ page, color, text }) => ({ page, color, text: text.slice(0, 1200) })) }))
      if (area === 'submissions') return new SubmissionRepository(db).list().filter(item => inRange(item.submittedDate) && matches(item.title, item.journal, item.notes))
        .slice(0, 30).map(({ id, title, journal, stages, revisionDueDate, revisionCompleted, notes }) =>
          ({ id, title, journal, stages, revisionDueDate, revisionCompleted, notes: notes.slice(0, 4000) }))
      const { enabled, focusText, hiddenPanels, railOrder } = readWidgetPreferences(new SettingsRepository(db).getWidget())
      return { enabled, focusText, hiddenPanels, railOrder, panels: desktopPanelTitles }
    }),
    tool('save_checkin', '在研究报表和打卡便签中保存一条完整的打卡。只有明确要求编辑现有记录时才传已查到的 id。跨午夜要明确设置 endsNextDay。', z.object({
      id: idSchema.optional(), entry: checkinInputSchema
    }).strict(), ({ id, entry }, { db }) => {
      const repo = new ReportsRepository(db)
      const existing = !id && repo.snapshot().checkins.find(item => item.date === entry.date && item.startTime === entry.startTime &&
        item.endTime === entry.endTime && Boolean(item.endsNextDay) === entry.endsNextDay)
      if (existing) return { saved: false, alreadyExists: true, entry: existing }
      const saved = repo.saveCheckin(entry, id)
      runtime.changed('reports')
      return { saved: true, entry: saved }
    }),
    tool('create_task', '在明确指定的现有项目中添加研究任务。先查询项目以获得其真实 id。', taskCreateSchema, (input, { db }) => {
      const saved = new TaskRepository(db).create(input)
      runtime.changed('tasks')
      return saved
    }),
    tool('update_task', '编辑现有研究任务。先根据标题查找 id。可调整时间、内容、优先级和完成状态。', z.object({
      id: idSchema, patch: taskPatchSchema
    }).strict(), ({ id, patch }, { db }) => {
      const saved = new TaskRepository(db).update(id, patch)
      runtime.changed('tasks')
      return saved
    }),
    tool('update_paper_notes', '按已查到的文献 id 更新笔记。追加时保留原文，只有明确要求替换时才用 replace。', z.object({
      id: idSchema, text: z.string().trim().min(1).max(50000), mode: z.enum(['append', 'replace'])
    }).strict(), ({ id, text, mode }, { db }) => {
      const repo = new LibraryRepository(db)
      const paper = repo.paper(id)
      const notes = mode === 'append' ? [paper.notes, text].filter(Boolean).join('\n\n') : text
      if (notes.length > 50000) throw new DomainError('VALIDATION', '笔记长度超过 50000 字。')
      repo.updatePaper(id, { notes })
      runtime.changed('library')
      return { id, title: paper.title, saved: true }
    }),
    tool('set_desktop_focus', '修改桌面便签显示的专注事项。', z.object({ text: z.string().trim().max(80) }).strict(), ({ text }, { db }) => {
      const settings = new SettingsRepository(db)
      settings.setWidget({ ...readWidgetPreferences(settings.getWidget()), focusText: text })
      runtime.changed('widget')
      return { focusText: text }
    }),
    tool('open_desktop_panel', '打开指定的桌面便签面板。', z.object({
      panel: z.enum(['checkin', 'tasks', 'submissions', 'reading', 'gpu', 'codex', 'more'])
    }).strict(), async ({ panel }) => {
      await runtime.openPanel(panel)
      return { opened: desktopPanelTitles[panel] }
    })
  ]
  return new Map(tools.map(item => [item.definition.name, item]))
}
