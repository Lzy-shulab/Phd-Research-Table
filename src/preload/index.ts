import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { WorkbenchApi } from '../shared/types'

window.addEventListener('DOMContentLoaded', () => {
  let lastActivity = 0
  const activity = () => { if (Date.now() - lastActivity > 2000) { lastActivity = Date.now(); ipcRenderer.send('desktop:activity') } }
  for (const event of ['pointerdown', 'keydown', 'input', 'wheel']) window.addEventListener(event, activity, { passive: true })
})

// The renderer gets a fixed capability list, never ipcRenderer or a generic invoke.
const api: WorkbenchApi = {
  openDesktopPanel: panel => ipcRenderer.invoke('widget:panel', panel),
  acknowledgeDesktopNotice: id => ipcRenderer.invoke('widget:acknowledge', id),
  saveGpuLogin: input => ipcRenderer.invoke('gpu:login', input),
  forgetGpuLogin: () => ipcRenderer.invoke('gpu:forget-login'),
  recognizeDesktopTask: (input, preferredProject) => ipcRenderer.invoke('desktop:recognize-task', input, preferredProject),
  setDesktopRailInteractive: interactive => ipcRenderer.invoke('widget:rail-interactive', interactive),
  desktopPanelReady: () => ipcRenderer.invoke('widget:panel-ready'),
  codexUsage: force => ipcRenderer.invoke('codex:usage', force),
  onCodexUsageChanged: handler => { const listener = (_event: Electron.IpcRendererEvent, snapshot: import('../shared/codex-usage').CodexUsageSnapshot) => handler(snapshot); ipcRenderer.on('codex:usage-changed', listener); return () => ipcRenderer.removeListener('codex:usage-changed', listener) },
  gpuMonitor: force => ipcRenderer.invoke('gpu:snapshot', force),
  syncCpolarSsh: () => ipcRenderer.invoke('gpu:ssh-sync'),
  setGpuAlerts: enabled => ipcRenderer.invoke('gpu:alerts', enabled),
  setGpuOwners: (deviceId, names) => ipcRenderer.invoke('gpu:owners', { deviceId, names }),
  onGpuMonitorChanged: handler => { const listener = (_event: Electron.IpcRendererEvent, snapshot: import('../shared/gpu').GpuMonitorSnapshot) => handler(snapshot); ipcRenderer.on('gpu:changed', listener); return () => ipcRenderer.removeListener('gpu:changed', listener) },
  openGpuWebsite: () => ipcRenderer.invoke('gpu:website'),
  copyGpuTunnel: id => ipcRenderer.invoke('gpu:tunnel', id, 'copy'),
  openGpuTunnel: id => ipcRenderer.invoke('gpu:tunnel', id, 'open'),
  returnToDesktop: () => ipcRenderer.invoke('widget:return'),
  workbenchReady: () => ipcRenderer.send('workbench:ready'),
  onWorkbenchShown: handler => { const listener = () => handler(); ipcRenderer.on('workbench:shown', listener); return () => ipcRenderer.removeListener('workbench:shown', listener) },
  desktopLibrary: () => ipcRenderer.invoke('desktop:library'),
  desktopReadingStatus: () => ipcRenderer.invoke('desktop:reading-status'),
  desktopOverview: () => ipcRenderer.invoke('desktop:overview'),
  onDesktopOverviewChanged: handler => { const listener = () => handler(); ipcRenderer.on('desktop:overview-changed', listener); return () => ipcRenderer.removeListener('desktop:overview-changed', listener) },
  importDesktopPapers: (paths, folderId) => ipcRenderer.invoke('desktop:import-papers', paths, folderId),
  pickDesktopPapers: folderId => ipcRenderer.invoke('desktop:pick-papers', folderId),
  openDesktopPaper: (id, variant) => ipcRenderer.invoke('desktop:open-paper', id, variant),
  onOpenDesktopPaper: handler => { const listener = (_event: Electron.IpcRendererEvent, paper: {id: string;variant: import('../shared/types').PaperVariant}) => handler(paper); ipcRenderer.on('desktop:open-paper', listener); return () => ipcRenderer.removeListener('desktop:open-paper', listener) },
  onDesktopPanelShown: handler => { const listener = () => handler(); ipcRenderer.on('desktop:panel-shown', listener); return () => ipcRenderer.removeListener('desktop:panel-shown', listener) },
  setRevisionCompleted: (id, completed) => ipcRenderer.invoke('submission:revision-completed', id, completed),
  desktopTasks: () => ipcRenderer.invoke('desktop:tasks'),
  onTasksChanged: handler => {
    const listener = () => handler()
    ipcRenderer.on('tasks:changed', listener)
    return () => ipcRenderer.removeListener('tasks:changed', listener)
  },
  widgetSnapshot: () => ipcRenderer.invoke('widget:snapshot'),
  updateWaterReminder: action => ipcRenderer.invoke('widget:water-reminder', action),
  updateWidgetPreferences: patch => ipcRenderer.invoke('widget:preferences', patch),
  showWidget: () => ipcRenderer.invoke('widget:show'),
  hideWidget: () => ipcRenderer.invoke('widget:hide'),
  openWorkbench: () => ipcRenderer.invoke('widget:open-main'),
  setWidgetCompact: compact => ipcRenderer.invoke('widget:compact', compact),
  widgetWeather: force => ipcRenderer.invoke('widget:weather', force),
  searchWidgetCities: query => ipcRenderer.invoke('widget:city-search', query),
  onWidgetChanged: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: import('../shared/widget').WidgetSnapshot) => handler(value)
    ipcRenderer.on('widget:changed', listener)
    return () => ipcRenderer.removeListener('widget:changed', listener)
  },
  onReportsChanged: handler => {
    const listener = () => handler()
    ipcRenderer.on('reports:changed', listener)
    return () => ipcRenderer.removeListener('reports:changed', listener)
  },
  saveCheckinAbsence: (input, id) => ipcRenderer.invoke('reports:absence-save', input, id),
  deleteCheckinAbsence: id => ipcRenderer.invoke('reports:absence-delete', id),
  saveCheckin: (input, id) => ipcRenderer.invoke('reports:checkin-save', input, id),
  startCheckin: input => ipcRenderer.invoke('reports:checkin-start', input),
  deleteCheckin: id => ipcRenderer.invoke('reports:checkin-delete', id),
  researchReport: () => ipcRenderer.invoke('reports:snapshot'),
  saveReportSettings: input => ipcRenderer.invoke('reports:settings', input),
  saveStipend: (input, id) => ipcRenderer.invoke('reports:stipend-save', input, id),
  deleteStipend: id => ipcRenderer.invoke('reports:stipend-delete', id),
  saveReadingDate: input => ipcRenderer.invoke('reports:reading-date', input),
  countdowns: () => ipcRenderer.invoke('countdowns:list'),
  saveCountdown: (input, id) => ipcRenderer.invoke('countdown:save', input, id),
  deleteCountdown: (id) => ipcRenderer.invoke('countdown:delete', id),
  setWindowPalette: (palette) => ipcRenderer.invoke('window:palette', palette),
  generateArxivOverview: (input) => ipcRenderer.invoke('arxiv:overview', input),
  updateSnapshot: () => ipcRenderer.invoke('update:snapshot'),
  prepareUpdate: () => ipcRenderer.invoke('update:prepare'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof handler>[0]) => handler(snapshot)
    ipcRenderer.on('update:changed', listener)
    return () => { ipcRenderer.removeListener('update:changed', listener) }
  },
  paperOverview: (id) => ipcRenderer.invoke('library:overview', id),
  generatePaperOverview: (input) => ipcRenderer.invoke('library:overview-generate', input),
  assistantSettings: () => ipcRenderer.invoke('assistant:settings'),
  saveAssistantSettings: (input) => ipcRenderer.invoke('assistant:save', input),
  setAssistantRecognitionEnabled: (enabled) => ipcRenderer.invoke('assistant:recognition', enabled),
  testAssistant: () => ipcRenderer.invoke('assistant:test'),
  planWithAssistant: (input) => ipcRenderer.invoke('assistant:plan', input),
  interfacePreferences: () => ipcRenderer.invoke('interface:snapshot'),
  updateInterfacePreferences: (patch) => ipcRenderer.invoke('interface:update', patch),
  uploadBackground: () => ipcRenderer.invoke('interface:upload'),
  dailyEncouragement: (retry) => ipcRenderer.invoke('encouragement:daily', retry),
  openEncouragementSource: () => ipcRenderer.invoke('encouragement:source'),
  onEncouragementChanged: (handler) => { const listener = () => handler(); ipcRenderer.on('encouragement:changed', listener); return () => { ipcRenderer.removeListener('encouragement:changed', listener) } },
  submissionsSnapshot: () => ipcRenderer.invoke('submissions:snapshot'),
  createSubmission: (input) => ipcRenderer.invoke('submission:create', input),
  updateSubmission: (id, input) => ipcRenderer.invoke('submission:update', id, input),
  updateSubmissionProgress: (id, patch) => ipcRenderer.invoke('submission:update-progress', id, patch),
  deleteSubmission: (id) => ipcRenderer.invoke('submission:delete', id),
  onSubmissionsChanged: (handler) => { const listener = () => handler(); ipcRenderer.on('submissions:changed', listener); return () => { ipcRenderer.removeListener('submissions:changed', listener) } },
  onOpenSubmissions: (handler) => { const listener = () => handler(); ipcRenderer.on('submission:open', listener); return () => { ipcRenderer.removeListener('submission:open', listener) } },
  enrichPaperMetadata: (id, input) => ipcRenderer.invoke('metadata:enrich', id, input),
  failPaperMetadata: (id, message) => ipcRenderer.invoke('metadata:failed', id, message),
  setMetadataOnline: (enabled) => ipcRenderer.invoke('metadata:online', enabled),
  storageSnapshot: () => ipcRenderer.invoke('storage:snapshot'),
  chooseStorageDirectory: (kind) => ipcRenderer.invoke('storage:choose', kind),
  chooseDatabaseDirectory: () => ipcRenderer.invoke('storage:database-choose'),
  revealStorageDirectory: (kind) => ipcRenderer.invoke('storage:reveal', kind),
  saveArxivSettings: (settings) => ipcRenderer.invoke('arxiv:settings', settings),
  runArxivDaily: () => ipcRenderer.invoke('arxiv:run'),
  cancelArxivDaily: () => ipcRenderer.invoke('arxiv:cancel'),
  runPaperDaily: () => ipcRenderer.invoke('paper-daily:run'),
  cancelPaperDaily: () => ipcRenderer.invoke('paper-daily:cancel'),
  paperDailyAction: (id, action) => ipcRenderer.invoke('paper-daily:action', id, action),
  refreshJournalAbbreviations: () => ipcRenderer.invoke('library:journal-abbreviations'),
  workbenchCodexModels: () => ipcRenderer.invoke('workbench-codex:models'),
  sendWorkbenchCodex: input => ipcRenderer.invoke('workbench-codex:send', input),
  interruptWorkbenchCodex: () => ipcRenderer.invoke('workbench-codex:interrupt'),
  resetWorkbenchCodex: () => ipcRenderer.invoke('workbench-codex:reset'),
  copyWorkbenchCodexReply: text => ipcRenderer.invoke('workbench-codex:copy', text),
  onWorkbenchCodexEvent: handler => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof handler>[0]) => handler(value)
    ipcRenderer.on('workbench-codex:event', listener)
    return () => { ipcRenderer.removeListener('workbench-codex:event', listener) }
  },
  revealArxivDirectory: () => ipcRenderer.invoke('arxiv:directory'),
  arxivCandidateAction: (id, action) => ipcRenderer.invoke('arxiv:candidate-action', id, action),
  retryArxivTranslations: () => ipcRenderer.invoke('arxiv:translations-retry'),
  pickPublicationPdf: () => ipcRenderer.invoke('publication:pick'),
  readPublicationPdf: (path) => ipcRenderer.invoke('publication:read-selected', path),
  previewPublicationMetadata: (input, overrides) => ipcRenderer.invoke('publication:metadata-preview', input, overrides),
  createPublication: (path, metadata) => ipcRenderer.invoke('publication:create', path, metadata),
  attachPublicationPdf: (id, path) => ipcRenderer.invoke('publication:attach', id, path),
  exportPublications: (format, ids) => ipcRenderer.invoke('publication:export', format, ids),
  librarySnapshot: () => ipcRenderer.invoke('library:snapshot'),
  onLibraryChanged: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('library:changed', listener)
    return () => { ipcRenderer.removeListener('library:changed', listener) }
  },
  onTranslationProgress: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof handler>[0], active?: Parameters<typeof handler>[1]) =>
      handler(progress, active ?? (progress ? [progress] : []))
    ipcRenderer.on('library:translation-progress', listener)
    return () => { ipcRenderer.removeListener('library:translation-progress', listener) }
  },
  createFolder: (input) => ipcRenderer.invoke('library:folder-create', input),
  updateFolder: (id, input) => ipcRenderer.invoke('library:folder-update', id, input),
  deleteFolder: (id) => ipcRenderer.invoke('library:folder-delete', id),
  pickPapers: (folder, translate) => ipcRenderer.invoke('library:pick', folder, translate),
  importPapers: (paths, folder, translate) => ipcRenderer.invoke('library:import', paths, folder, translate),
  droppedFilePath: (file) => webUtils.getPathForFile(file),
  updatePaper: (id, patch) => ipcRenderer.invoke('library:paper-update', id, patch),
  deletePaper: (id) => ipcRenderer.invoke('library:paper-delete', id),
  retryTranslation: (id) => ipcRenderer.invoke('library:retry', id),
  cancelTranslation: (id) => ipcRenderer.invoke('library:translation-cancel', id),
  setTranslationPaused: (paused) => ipcRenderer.invoke('library:translation-pause', paused),
  reorderTranslations: (ids) => ipcRenderer.invoke('library:translation-reorder', ids),
  readPaper: (id, variant) => ipcRenderer.invoke('library:read', id, variant),
  exportPaper: (id, variant) => ipcRenderer.invoke('library:export', id, variant),
  translationHealth: () => ipcRenderer.invoke('library:health'),
  codexTranslationStatus: () => ipcRenderer.invoke('library:codex-status'),
  openJournalRankConsole: () => ipcRenderer.invoke('library:journal-console'),
  saveJournalRankSettings: (input) => ipcRenderer.invoke('library:journal-settings', input),
  refreshJournalRanks: (journals, force) => ipcRenderer.invoke('library:journal-refresh', journals, force),
  installTranslationEngine: () => ipcRenderer.invoke('library:engine-install'),
  cancelTranslationEngineInstall: () => ipcRenderer.invoke('library:engine-install-cancel'),
  translationProfiles: () => ipcRenderer.invoke('library:translation-profiles'),
  saveTranslationProfile: (input) => ipcRenderer.invoke('library:translation-profile-save', input),
  activateTranslationProfile: (id) => ipcRenderer.invoke('library:translation-profile-activate', id),
  deleteTranslationProfile: (id) => ipcRenderer.invoke('library:translation-profile-delete', id),
  chooseTranslationDirectory: () => ipcRenderer.invoke('library:directory'),
  setAutoTranslate: (enabled) => ipcRenderer.invoke('library:auto', enabled),
  onBeforeClose: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => {
      void handler()
        .then((ok) => ipcRenderer.send('app:flush-result', token, ok))
        .catch(() => ipcRenderer.send('app:flush-result', token, false))
    }
    ipcRenderer.on('app:flush', listener)
    return () => {
      ipcRenderer.removeListener('app:flush', listener)
    }
  },
  bootstrap: () => ipcRenderer.invoke('workbench:bootstrap'),
  createTask: (input) => ipcRenderer.invoke('task:create', input),
  createTaskSeries: (input) => ipcRenderer.invoke('task:series-create', input),
  updateTaskSeries: (seriesId, fromDate, patch) => ipcRenderer.invoke('task:series-update', seriesId, fromDate, patch),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  completeTask: (id, completed) => ipcRenderer.invoke('task:complete', id, completed),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  reorderTasks: (ids) => ipcRenderer.invoke('task:reorder', ids),
  taskTemplates: () => ipcRenderer.invoke('task:templates'),
  saveTaskTemplate: (template) => ipcRenderer.invoke('task:template-save', template),
  deleteTaskTemplate: (id) => ipcRenderer.invoke('task:template-delete', id),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  updateProject: (id, patch) => ipcRenderer.invoke('project:update', id, patch),
  deleteProject: (id, moveToId, taskAction) => ipcRenderer.invoke('project:delete', id, moveToId, taskAction),
  setAppearance: (appearance) => ipcRenderer.invoke('settings:appearance', appearance),
  reuseAssistantForTranslation: () => ipcRenderer.invoke('settings:reuse-assistant-translation')
}
contextBridge.exposeInMainWorld('workbench', api)
