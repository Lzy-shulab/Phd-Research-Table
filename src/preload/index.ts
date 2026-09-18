import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { WorkbenchApi } from '../shared/types'

// The renderer gets a fixed capability list, never ipcRenderer or a generic invoke.
const api: WorkbenchApi = {
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
  revealArxivDirectory: () => ipcRenderer.invoke('arxiv:directory'),
  pickPublicationPdf: () => ipcRenderer.invoke('publication:pick'),
  readPublicationPdf: (path) => ipcRenderer.invoke('publication:read-selected', path),
  previewPublicationMetadata: (input, overrides) => ipcRenderer.invoke('publication:metadata-preview', input, overrides),
  createPublication: (path, metadata) => ipcRenderer.invoke('publication:create', path, metadata),
  librarySnapshot: () => ipcRenderer.invoke('library:snapshot'),
  onLibraryChanged: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('library:changed', listener)
    return () => { ipcRenderer.removeListener('library:changed', listener) }
  },
  onTranslationProgress: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof handler>[0]) => handler(progress)
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
  readPaper: (id, variant) => ipcRenderer.invoke('library:read', id, variant),
  exportPaper: (id, variant) => ipcRenderer.invoke('library:export', id, variant),
  translationHealth: () => ipcRenderer.invoke('library:health'),
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
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  completeTask: (id, completed) => ipcRenderer.invoke('task:complete', id, completed),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  reorderTasks: (ids) => ipcRenderer.invoke('task:reorder', ids),
  createProject: (input) => ipcRenderer.invoke('project:create', input),
  updateProject: (id, patch) => ipcRenderer.invoke('project:update', id, patch),
  deleteProject: (id, moveToId) => ipcRenderer.invoke('project:delete', id, moveToId),
  setAppearance: (appearance) => ipcRenderer.invoke('settings:appearance', appearance)
}
contextBridge.exposeInMainWorld('workbench', api)
