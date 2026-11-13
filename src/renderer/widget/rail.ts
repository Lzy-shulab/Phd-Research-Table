import './rail.css'
import './theme.css'
import '@fontsource-variable/manrope'
import { railIcons } from './rail-icons'
import type { DesktopPanel, DesktopReadingStatus } from '../../shared/widget'
import type { GpuMonitorSnapshot } from '../../shared/gpu'
import { codexRailSummary, type CodexUsageSnapshot } from '../../shared/codex-usage'
import type { WidgetSnapshot } from '../../shared/widget'
import { mountWaterReminder } from './rail-water'
import { mountRailNotice } from './rail-notices'
import { animateDesktopReorder, captureDesktopPositions } from './desktop-motion'

// Clip each translated button before it can enlarge the vertical scroller.
for (const button of document.querySelectorAll<HTMLButtonElement>('nav button')) {
  const slot = document.createElement('div')
  slot.className = 'rail-slot'
  button.classList.add('rail-note')
  button.replaceWith(slot)
  slot.append(button)
}

// The transparent space left by folded notes belongs to the desktop underneath.
let railInteractive = false
let pointer: { x: number; y: number } | null = null
const updatePointer = () => {
  const interactive = Boolean(pointer && document.elementFromPoint(pointer.x, pointer.y)?.closest('button, .rail-water, .rail-notice, [role=alert]'))
  if (interactive === railInteractive) return
  railInteractive = interactive
  void window.workbench.setDesktopRailInteractive(interactive)
}
window.addEventListener('mousemove', event => { pointer = { x: event.clientX, y: event.clientY }; updatePointer() })
document.documentElement.addEventListener('mouseleave', () => { pointer = null; updatePointer() })
document.addEventListener('transitionend', event => { if (event.propertyName === 'transform') updatePointer() })
document.querySelector('nav')?.addEventListener('scroll', updatePointer)

for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) target.innerHTML = railIcons[target.dataset.icon as keyof typeof railIcons]
const alert = document.querySelector<HTMLElement>('[role=alert]')!
const showError = (result: { ok: boolean; error?: { message: string } }) => { alert.textContent = result.ok ? '' : result.error?.message ?? '打开失败，请重试' }
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-panel]')) button.addEventListener('click', async () => {
  button.classList.add('is-opening')
  button.classList.add('is-docked')
  button.blur()
  const result = await window.workbench.openDesktopPanel(button.dataset.panel as DesktopPanel)
  showError(result); button.classList.remove('is-opening')
  if (!result.ok) button.classList.remove('is-docked')
})
const checkin = document.querySelector<HTMLButtonElement>('[data-panel=checkin]')!
const tasks = document.querySelector<HTMLButtonElement>('[data-panel=tasks]')!
const submissions = document.querySelector<HTMLButtonElement>('[data-panel=submissions]')!
const reading = document.querySelector<HTMLButtonElement>('[data-panel=reading]')!
const gpu = document.querySelector<HTMLButtonElement>('[data-panel=gpu]')!
const codex = document.querySelector<HTMLButtonElement>('[data-panel=codex]')!
const renderCodex = (state: CodexUsageSnapshot) => {
  document.querySelector('#codex-status')!.textContent = codexRailSummary(state)
  codex.classList.toggle('is-urgent', !state.error && state.windows.some(item => item.remainingPercent !== null && item.remainingPercent <= 10))
  codex.title = state.error ?? state.windows.map(item => `${item.label}剩余 ${item.remainingPercent === null ? '未知' : item.remainingPercent + '%'}`).join('；')
  codex.setAttribute('aria-description', codex.title)
}
void window.workbench.codexUsage().then(result => { if (result.ok) renderCodex(result.data); else document.querySelector('#codex-status')!.textContent = '未连接' })
window.workbench.onCodexUsageChanged(renderCodex)
const renderGpu = (state: GpuMonitorSnapshot) => {
  document.querySelector('#gpu-status')!.textContent = state.auth === 'required' ? '点击登录' : state.error ? '待更新' : !state.updatedAt ? '连接中' : `${state.idle} / ${state.total} 空闲`
  gpu.classList.toggle('is-available', state.auth === 'ready' && !state.error && state.idle > 0)
  gpu.title = state.auth === 'required' ? '登录团队 GPU 看板' : state.error || `${state.idle} 张空闲，${state.busy} 张使用中，${state.unknown} 张未知；点击查看 GPU 与 Cpolar`
}
void window.workbench.gpuMonitor().then(result => { if (result.ok) renderGpu(result.data); else document.querySelector('#gpu-status')!.textContent = '未连接' })
window.workbench.onGpuMonitorChanged(renderGpu)
let readingState: DesktopReadingStatus = { queued: 0, failed: 0, paused: false, progress: null, unread: 0 }
const percent = (value: number | null) => value === null ? '—' : Math.round(value) + '%'
const orbit = (id: string, value: number | null) => document.querySelector('#' + id)!.setAttribute('stroke-dashoffset', String(100 - Math.max(0, Math.min(100, value ?? 0))))
const renderReading = () => {
  const { progress, queued, paused, unread, failed, queueError } = readingState
  reading.classList.toggle('is-translating', Boolean(progress || queued))
  reading.classList.toggle('is-unknown', Boolean(progress && progress.percent === null))
  document.querySelector('#reading-status')!.textContent = progress ? progress.percent === null ? '准备中' : percent(progress.percent)
    : queued ? paused ? '暂停' : queueError ? '翻译待设置' : queued + ' 篇排队' : (unread ?? 0) + ' 篇'
  orbit('reading-progress', progress?.percent ?? null)
  reading.title = progress ? progress.stage : queued ? paused ? '翻译队列已暂停' : queueError || queued + ' 篇等待翻译' : (unread ?? 0) + ' 篇待阅读' + (failed ? '，' + failed + ' 篇翻译需重试' : '') + '；可拖入 PDF'
}
let requestId = 0
let progressRevision = 0
const refreshOverview = async () => {
  const id = ++requestId
  const seenProgress = progressRevision
  const result = await window.workbench.desktopOverview()
  if (!result.ok || id !== requestId) return
  const state = result.data
  orbit('week-orbit', state.attendance.week); orbit('month-orbit', state.attendance.month)
  document.querySelector('#week-value')!.textContent = percent(state.attendance.week)
  document.querySelector('#month-value')!.textContent = percent(state.attendance.month)
  checkin.title = '内环 · 本周 ' + percent(state.attendance.week) + '；外环 · 本月 ' + percent(state.attendance.month)
  checkin.setAttribute('aria-description', checkin.title)
  document.querySelector('#task-status')!.textContent = state.tasks.remaining ? state.tasks.remaining + ' 项' : '已完成'
  tasks.classList.toggle('is-complete', state.tasks.remaining === 0)
  tasks.title = state.tasks.remaining + ' 项未完成；今日 ' + state.tasks.completedToday + ' / ' + state.tasks.totalToday
  const days = state.submissions.dueDays
  document.querySelector('#submission-status')!.textContent = days === null ? state.submissions.active + ' 篇' : days < 0 ? '逾 ' + -days + ' 天' : days === 0 ? '今天' : days + ' 天'
  submissions.classList.toggle('is-urgent', days !== null && days <= 3)
  submissions.title = days === null ? state.submissions.active + ' 篇投稿进行中' : (state.submissions.title ?? '') + ' · 返修' + (days < 0 ? '已逾期 ' + -days + ' 天' : days === 0 ? '今天截止' : '还有 ' + days + ' 天')
  readingState = { ...state.reading, progress: seenProgress === progressRevision ? state.reading.progress : readingState.progress }
  renderReading()
}
let overviewTimer: ReturnType<typeof setTimeout> | undefined
const scheduleOverview = () => { if (overviewTimer) return; overviewTimer = setTimeout(() => { overviewTimer = undefined; void refreshOverview() }, 100) }
void refreshOverview()
window.workbench.onDesktopOverviewChanged(scheduleOverview)
window.workbench.onLibraryChanged(scheduleOverview)
window.workbench.onTranslationProgress(progress => {
  progressRevision++
  readingState = { ...readingState, progress }
  renderReading()
  if (!progress) scheduleOverview()
})
const atMidnight = () => { const next = new Date(); next.setHours(24,0,1,0); setTimeout(() => { void refreshOverview(); atMidnight() }, next.getTime() - Date.now()) }
atMidnight()
reading.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect='copy'; reading.classList.add('is-dragging') })
reading.addEventListener('dragleave', event => { if (!reading.contains(event.relatedTarget as Node)) reading.classList.remove('is-dragging') })
reading.addEventListener('drop', async event => {
  event.preventDefault(); reading.classList.remove('is-dragging')
  const paths = [...(event.dataTransfer?.files ?? [])].filter(f => f.name.toLowerCase().endsWith('.pdf')).map(f => window.workbench.droppedFilePath(f)).filter(Boolean)
  if (!paths.length) { showError({ok:false,error:{message:'请拖入 PDF 文件'}}); return }
  document.querySelector('#reading-status')!.textContent='保存中'
  await window.workbench.openDesktopPanel('reading')
  const result = await window.workbench.importDesktopPapers(paths, null)
  showError(result)
  await refreshOverview()
  if (result.ok && result.data.translationMessage) reading.title=result.data.translationMessage
})
const launcher = document.querySelector<HTMLButtonElement>('#workbench')!
const renderWater = mountWaterReminder(checkin, launcher, updatePointer, showError)
const noticeAnchors = { checkin, gpu, cpolar: gpu, task: tasks }
const noticeLanes = [checkin, gpu, tasks, launcher].map(anchor => ({ anchor, render: mountRailNotice(anchor, updatePointer, showError) }))
launcher.addEventListener('click', async () => {
  if (launcher.getAttribute('aria-busy') === 'true') return
  launcher.classList.add('is-opening'); launcher.setAttribute('aria-busy', 'true')
  const result = await window.workbench.openWorkbench(); showError(result)
  if (!result.ok) { launcher.classList.remove('is-opening'); launcher.setAttribute('aria-busy', 'false') }
})
let renderedOrder = ''
let renderedLayout = ''
const renderWidget = (snapshot: WidgetSnapshot) => {
  document.documentElement.dataset.panelOpen = String(snapshot.visible)
  document.documentElement.dataset.widgetTheme = snapshot.preferences.theme
  document.documentElement.style.setProperty('--glass-opacity', String(snapshot.preferences.glassOpacity))
  const shortcuts = document.querySelector('#rail-shortcuts')!
  const order = snapshot.preferences.railOrder.join(',')
  const layout = order + ':' + snapshot.preferences.hiddenPanels.join(',')
  const positions = renderedLayout && renderedLayout !== layout ? captureDesktopPositions(shortcuts.querySelectorAll<HTMLElement>('.rail-slot')) : null
  for (const id of snapshot.preferences.railOrder) {
    const button = document.querySelector<HTMLButtonElement>(`[data-panel=${id}]`)!
    button.hidden = snapshot.preferences.hiddenPanels.includes(id)
    button.parentElement!.hidden = button.hidden
    if (order !== renderedOrder) shortcuts.append(button.parentElement!)
  }
  renderedOrder = order
  renderedLayout = layout
  if (positions) animateDesktopReorder(positions, updatePointer)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-panel]')) {
    const selected = snapshot.visible && snapshot.panel === button.dataset.panel
    button.setAttribute('aria-pressed', String(selected))
    if (!button.classList.contains('is-opening')) button.classList.toggle('is-docked', selected)
  }
  launcher.setAttribute('aria-pressed', String(Boolean(snapshot.workbenchVisible)))
  if (snapshot.workbenchVisible) { launcher.classList.remove('is-opening'); launcher.setAttribute('aria-busy', 'false') }
  renderWater(snapshot.waterReminderAt)
  for (const { anchor, render } of noticeLanes) {
    render(snapshot.notices.filter(item => (noticeAnchors[item.kind].hidden ? launcher : noticeAnchors[item.kind]) === anchor))
  }
}
void window.workbench.widgetSnapshot().then(result => { if (result.ok) renderWidget(result.data) })
window.workbench.onWidgetChanged(renderWidget)
