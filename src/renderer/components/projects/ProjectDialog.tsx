import { colorLabels } from '../../../shared/labels'
import { useState } from 'react'
import { Archive, ArchiveRestore, Check, Trash2 } from 'lucide-react'
import { colorKeys, type ColorKey, type Project, type ProjectTaskAction } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'

export function ProjectDialog({
  project,
  onClose,
  onCreated
}: {
  project?: Project
  onClose: () => void
  onCreated?: (project: Project) => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [colorKey, setColorKey] = useState<ColorKey>(project?.colorKey ?? 'blue')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moveTo, setMoveTo] = useState('')
  const [taskAction, setTaskAction] = useState<ProjectTaskAction>('delete')
  const projects = useWorkbench((s) => s.projects)
  const count = useWorkbench((s) => s.tasks.filter((t) => t.projectId === project?.id).length)
  const completedCount = useWorkbench((s) => s.tasks.filter((t) => t.projectId === project?.id && t.status === 'completed').length)
  const createProject = useWorkbench((s) => s.createProject)
  const updateProject = useWorkbench((s) => s.updateProject)
  const deleteProject = useWorkbench((s) => s.deleteProject)
  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const result = project
      ? await updateProject(project.id, { name, description, colorKey })
      : await createProject({ name, description, colorKey })
    setBusy(false)
    if (!result) return
    if (!project && typeof result !== 'boolean') onCreated?.(result)
    onClose()
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
        title={project ? '项目详情' : '新建项目'}
        description="将相关研究任务整理到同一个项目中。"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="project-form"
        >
          <label className="field">
            项目名称
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：博士论文"
              maxLength={100}
              required
            />
          </label>
          <label className="field">
            描述
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述这个项目的研究方向"
              rows={3}
              maxLength={10000}
            />
          </label>
          <fieldset className="color-field">
            <legend>项目颜色</legend>
            <div className="color-options">
              {colorKeys.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-option project-${color}`}
                  aria-label={`${colorLabels[color]}项目颜色`}
                  aria-pressed={colorKey === color}
                  onClick={() => setColorKey(color)}
                >
                  {colorKey === color && <Check size={15} />}
                </button>
              ))}
            </div>
          </fieldset>
          {project && (
            <div className="project-management">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const ok = await updateProject(project.id, { archived: !project.archivedAt })
                  setBusy(false)
                  if (ok) onClose()
                }}
              >
                {project.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                {project.archivedAt ? '恢复项目' : '归档项目'}
              </Button>
              <Button
                variant="ghost"
                className="danger-text"
                disabled={busy}
                onClick={() => { setTaskAction('delete'); setConfirmDelete(true) }}
              >
                <Trash2 size={15} />
                删除项目
              </Button>
            </div>
          )}
          {project && (
            <p className="field-hint">归档后项目将收起，其中的任务仍可在研究计划中查看。</p>
          )}
          <div className="dialog-actions">
            <Button onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy ? '正在保存…' : project ? '完成' : '创建项目'}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmDelete}
        title={`删除“${project?.name ?? ''}”？`}
        description={
          count
            ? `此项目有 ${count} 项任务：${count - completedCount} 项未完成、${completedCount} 项已完成。请确认任务的处理方式。`
            : '此项目没有任务，删除后无法恢复。'
        }
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmDelete(false)
        }}
      >
        {count > 0 && <fieldset className="project-delete-options"><legend>项目中的任务</legend>{([
          ['delete', '连同任务删除', `删除项目及其 ${count} 项任务，无法恢复。`],
          ['retain', '保留任务', '任务归为“未分配项目”，日期和完成状态保留。'],
          ['transfer', '转移任务', '将任务移入另一个项目。']
        ] as const).map(([value, label, hint]) => <label key={value} className={taskAction === value ? 'is-selected' : ''}><input type="radio" name="project-task-action" value={value} checked={taskAction === value} disabled={busy} onChange={() => setTaskAction(value)} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</fieldset>}
        {count > 0 && taskAction === 'transfer' && (
          <label className="field">
            将任务转移到
            <select
              aria-label="将任务转移到"
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
            >
              <option value="" disabled>
                选择接收项目
              </option>
              {projects
                .filter((p) => p.id !== project?.id && !p.archivedAt)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {count > 0 && taskAction === 'transfer' &&
          projects.filter((p) => p.id !== project?.id && !p.archivedAt).length === 0 && (
            <p className="field-hint">
              暂时没有其他项目。可以取消并归档当前项目，或先创建接收项目。
            </p>
          )}
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy || (count > 0 && taskAction === 'transfer' && !moveTo)}
            onClick={async () => {
              if (!project) return
              setBusy(true)
              const ok = await deleteProject(project.id, taskAction === 'transfer' ? moveTo : undefined, taskAction)
              setBusy(false)
              if (ok) onClose()
            }}
          >
            {busy ? '正在处理…' : !count ? '删除项目' : taskAction === 'delete' ? `删除项目及 ${count} 项任务` : taskAction === 'retain' ? '保留任务并删除项目' : '转移任务并删除项目'}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
