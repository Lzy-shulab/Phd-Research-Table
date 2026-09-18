import { create } from 'zustand'
import type {
  Appearance,
  ErrorCode,
  PlannerView,
  Project,
  ProjectInput,
  ProjectPatch,
  Result,
  Section,
  Task,
  TaskCreate,
  TaskPatch
} from '../../shared/types'
import { dateKey } from '../lib/dates'

interface Notice {
  id: number
  message: string
  kind: 'error' | 'info'
}
interface WorkbenchState {
  ready: boolean
  loading: boolean
  startupError: string | null
  tasks: Task[]
  projects: Project[]
  drafts: Record<string, TaskPatch>
  saveErrors: Record<string, string>
  saving: number
  appearance: Appearance
  databasePath: string
  section: Section
  view: PlannerView
  projectId: string | null
  selectedTaskId: string | null
  projectFolds: Record<string, boolean>
  setProjectFolds: (folds: Record<string, boolean>) => void
  captureRequest: number
  calendarDate: string
  calendarMode: 'day' | 'week'
  setCalendar: (date: string, mode?: 'day' | 'week') => void
  discardDraft: (id: string) => void
  notices: Notice[]
  bootstrap: () => Promise<void>
  navigate: (view: PlannerView, projectId?: string | null) => void
  setSection: (section: Section) => void
  selectTask: (id: string | null) => void
  focusCapture: () => void
  notify: (message: string, kind?: Notice['kind']) => void
  dismiss: (id: number) => void
  createTask: (input: TaskCreate) => Promise<Task | null>
  editTask: (id: string, patch: TaskPatch, immediate?: boolean) => void
  flushTask: (id: string) => Promise<boolean>
  flushAll: () => Promise<boolean>
  completeTask: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<boolean>
  reorderTasks: (ids: string[]) => Promise<void>
  createProject: (input: ProjectInput) => Promise<Project | null>
  updateProject: (id: string, patch: ProjectPatch) => Promise<boolean>
  deleteProject: (id: string, moveToId?: string) => Promise<boolean>
  setAppearance: (appearance: Appearance) => Promise<void>
}
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let mutationQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(work)
  mutationQueue = result.catch(() => undefined)
  return result
}
class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new ApiError(result.error.code, result.error.message)
  return result.data
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试。'

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  ready: false,
  loading: true,
  startupError: null,
  tasks: [],
  projects: [],
  drafts: {},
  saveErrors: {},
  saving: 0,
  appearance: 'system',
  databasePath: '',
  section: 'planner',
  projectFolds: {},
  setProjectFolds: (projectFolds) => set({ projectFolds }),
  view: 'today',
  projectId: null,
  selectedTaskId: null,
  captureRequest: 0,
  notices: [],
  calendarDate: dateKey(),
  calendarMode: 'week',
  setCalendar: (date, mode) =>
    set((state) => ({
      calendarDate: date,
      calendarMode: mode ?? state.calendarMode,
      view: 'calendar',
      projectId: null,
      selectedTaskId: null
    })),
  discardDraft: (id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    set((state) => {
      const drafts = { ...state.drafts },
        saveErrors = { ...state.saveErrors }
      delete drafts[id]
      delete saveErrors[id]
      return { drafts, saveErrors }
    })
  },
  bootstrap: async () => {
    set({ loading: true, startupError: null })
    try {
      if (!window.workbench) throw new Error('请在桌面应用中打开科研工作台。')
      const snapshot = unwrap(await window.workbench.bootstrap())
      set({ ...snapshot, ready: true, loading: false })
    } catch (error) {
      set({ loading: false, startupError: errorText(error) })
    }
  },
  navigate: (view) =>
    set({
      view: view === 'project' || view === 'projects' ? 'all' : view,
      projectId: null,
      selectedTaskId: null
    }),
  setSection: (section) => set({ section, selectedTaskId: null }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  focusCapture: () =>
    set((state) => ({
      section: 'planner',
      captureRequest: state.captureRequest + 1,
      selectedTaskId: null
    })),
  notify: (message, kind = 'error') =>
    set((state) => ({
      notices: [
        ...state.notices.filter((n) => n.message !== message).slice(-2),
        { id: Date.now() + Math.random(), message, kind }
      ]
    })),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  createTask: (input) =>
    serialize(async () => {
      try {
        const task = unwrap(await window.workbench.createTask(input))
        set((state) => ({ tasks: [...state.tasks, task] }))
        return task
      } catch (error) {
        get().notify(errorText(error))
        return null
      }
    }),
  editTask: (id, patch, immediate = false) => {
    set((state) => ({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], ...patch } } }))
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(
        () => {
          void get().flushTask(id)
        },
        immediate ? 0 : 450
      )
    )
  },
  flushTask: (id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    return serialize(async () => {
      const patch = get().drafts[id]
      if (!patch) return true
      set((state) => ({ saving: state.saving + 1 }))
      try {
        const task = unwrap(await window.workbench.updateTask(id, patch))
        set((state) => {
          const drafts = { ...state.drafts },
            saveErrors = { ...state.saveErrors }
          if (drafts[id] === patch) delete drafts[id]
          delete saveErrors[id]
          return { tasks: state.tasks.map((t) => (t.id === id ? task : t)), drafts, saveErrors }
        })
        return true
      } catch (error) {
        set((state) => ({ saveErrors: { ...state.saveErrors, [id]: errorText(error) } }))
        // Validation belongs beside the editable fields; it should disappear when corrected.
        if (!(error instanceof ApiError && error.code === 'VALIDATION'))
          get().notify(errorText(error))
        return false
      } finally {
        set((state) => ({ saving: state.saving - 1 }))
      }
    })
  },
  flushAll: async () => {
    const results = await Promise.all(Object.keys(get().drafts).map((id) => get().flushTask(id)))
    await mutationQueue
    return results.every(Boolean) && Object.keys(get().drafts).length === 0
  },
  completeTask: async (id) => {
    if (!(await get().flushTask(id))) return
    await serialize(async () => {
      try {
        const task = get().tasks.find((t) => t.id === id)
        if (!task) return
        const next = unwrap(await window.workbench.completeTask(id, task.status !== 'completed'))
        set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? next : t)) }))
      } catch (error) {
        get().notify(errorText(error))
      }
    })
  },
  deleteTask: (id) =>
    serialize(async () => {
      try {
        unwrap(await window.workbench.deleteTask(id))
        clearTimeout(timers.get(id))
        timers.delete(id)
        set((state) => {
          const drafts = { ...state.drafts },
            saveErrors = { ...state.saveErrors }
          delete drafts[id]
          delete saveErrors[id]
          return {
            tasks: state.tasks.filter((t) => t.id !== id),
            drafts,
            saveErrors,
            selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId
          }
        })
        return true
      } catch (error) {
        get().notify(errorText(error))
        return false
      }
    }),
  reorderTasks: (ids) =>
    serialize(async () => {
      try {
        set({ tasks: unwrap(await window.workbench.reorderTasks(ids)) })
      } catch (error) {
        get().notify(errorText(error))
      }
    }),
  createProject: (input) =>
    serialize(async () => {
      try {
        const project = unwrap(await window.workbench.createProject(input))
        set((state) => ({
          projects: [...state.projects, project],
          selectedTaskId: null
        }))
        return project
      } catch (error) {
        get().notify(errorText(error))
        return null
      }
    }),
  updateProject: (id, patch) =>
    serialize(async () => {
      try {
        const project = unwrap(await window.workbench.updateProject(id, patch))
        set((state) => ({ projects: state.projects.map((p) => (p.id === id ? project : p)) }))
        return true
      } catch (error) {
        get().notify(errorText(error))
        return false
      }
    }),
  deleteProject: async (id, moveToId) => {
    if (!(await get().flushAll())) return false
    return serialize(async () => {
      try {
        unwrap(await window.workbench.deleteProject(id, moveToId))
        const snapshot = unwrap(await window.workbench.bootstrap())
        set({ ...snapshot, projectId: null, view: 'all', selectedTaskId: null })
        return true
      } catch (error) {
        get().notify(errorText(error))
        return false
      }
    })
  },
  setAppearance: (appearance) =>
    serialize(async () => {
      try {
        set({ appearance: unwrap(await window.workbench.setAppearance(appearance)) })
      } catch (error) {
        get().notify(errorText(error))
      }
    })
}))
