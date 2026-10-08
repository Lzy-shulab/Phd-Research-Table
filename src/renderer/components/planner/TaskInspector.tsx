import { useState } from 'react'
import { motion } from 'motion/react'
import {
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  Clock3,
  FileText,
  Flag,
  FolderOpen,
  Repeat2,
  Send,
  Trash2,
  X
} from 'lucide-react'
import { priorityLabels } from '../../../shared/labels'
import { priorities, type Task } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { minutes, timeFromMinutes } from '../../lib/dates'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/dialog'
import { DateInput } from '../ui/date-input'
import { TimeInput } from '../ui/time-input'
import { useLibrary } from '../../stores/library'
import { useSubmissions } from '../../stores/submissions'

export function TaskInspector({ task }: { task: Task }) {
  const projects = useWorkbench((s) => s.projects)
  const edit = useWorkbench((s) => s.editTask)
  const flush = useWorkbench((s) => s.flushTask)
  const discard = useWorkbench((s) => s.discardDraft)
  const dirty = useWorkbench((s) => !!s.drafts[task.id])
  const saveError = useWorkbench((s) => s.saveErrors[task.id])
  const saving = useWorkbench((s) => s.saving > 0)
  const close = useWorkbench((s) => s.selectTask)
  const complete = useWorkbench((s) => s.completeTask)
  const remove = useWorkbench((s) => s.deleteTask)
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [syncingSeries, setSyncingSeries] = useState(false)
  const eligible = projects.filter((p) => !p.archivedAt || p.id === task.projectId)
  const linkedPaper = useLibrary((state) => state.papers.find((paper) => paper.id === task.linkedPaperId))
  const linkedSubmission = useSubmissions((state) => state.submissions.find((submission) => submission.id === task.linkedSubmissionId))
  return (
    <motion.aside className="task-inspector" aria-label="任务详情" initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}>
      <div className="inspector-top">
        <span className="eyebrow">任务详情</span>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="关闭任务详情"
          onClick={() => close(null)}
        >
          <X size={17} />
        </Button>
        {task.seriesId && <div className="task-series-banner"><Repeat2 size={15} /><span><strong>每周重复安排</strong><small>当前编辑默认只影响本次；历史记录和后续安排不会静默改变。</small></span><Button disabled={syncingSeries} onClick={async () => { setSyncingSeries(true); await useWorkbench.getState().updateTaskSeries(task.seriesId!, task.occurrenceDate ?? task.scheduledDate ?? '', { title: task.title, projectId: task.projectId, priority: task.priority, estimatedMinutes: task.estimatedMinutes, checklist: task.checklist, milestone: task.milestone }); setSyncingSeries(false) }}>{syncingSeries ? '同步中…' : '同步本次及后续'}</Button></div>}
      </div>
      <div className="inspector-scroll">
        <Button
          className={
            task.status === 'completed' ? 'completion-button is-complete' : 'completion-button'
          }
          variant="ghost"
          onClick={() => void complete(task.id)}
        >
          {task.status === 'completed' ? <CheckCheck size={16} /> : <Circle size={16} />}
          {task.status === 'completed' ? '已完成 · 点击恢复' : '标记完成'}
        </Button>
        <textarea
          className="inspector-title"
          aria-label="任务标题"
          value={task.title}
          maxLength={500}
          rows={3}
          placeholder="任务标题"
          onChange={(e) => edit(task.id, { title: e.target.value })}
          onBlur={() => void flush(task.id)}
        />
        {!task.title.trim() && <p className="field-error">填写任务标题后即可保存。</p>}
        <div className="inspector-section-label">任务信息</div>
        <div className="inspector-fields">
          <label className="inspector-field">
            <span>
              <FolderOpen size={15} />
              项目
            </span>
            <select
              aria-label="所属项目"
              value={task.projectId ?? ''}
              onChange={(e) => edit(task.id, { projectId: e.target.value || null }, true)}
            >
              {!task.projectId && <option value="" disabled>请选择项目</option>}
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archivedAt ? '（已归档）' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="inspector-section-label">时间与优先级</div>
        <div className="inspector-fields">
          <label className="inspector-field">
            <span>
              <CalendarDays size={15} />
              安排到
            </span>
            <DateInput
              label="安排到"
              value={task.scheduledDate ?? ''}
              onChange={(value) =>
                edit(
                  task.id,
                  {
                    scheduledDate: value || null,
                    ...(!value ? { startTime: null, endTime: null } : {})
                  },
                  true
                )
              }
            />
          </label>
          {task.scheduledDate && <div className="time-fields">
            <div className="field">
              <span>开始时间</span>
              <TimeInput
                label="开始时间"
                placeholder="09:17"
                disabled={!task.scheduledDate}
                value={task.startTime ?? ''}
                fallback={task.startTime ?? '09:00'}
                onChange={(value) => {
                  const startTime = value || null
                  const endTime = !startTime
                    ? null
                    : task.endTime
                      ? task.endTime
                      : /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) && minutes(startTime) < 1439
                        ? timeFromMinutes(Math.min(minutes(startTime) + 60, 1439))
                        : null
                  edit(task.id, { startTime, endTime }, true)
                }}
              />
            </div>
            <div className="field">
              <span>结束时间</span>
              <TimeInput
                label="结束时间"
                placeholder="10:43"
                disabled={!task.startTime}
                value={task.endTime ?? ''}
                fallback={task.endTime ?? (task.startTime && minutes(task.startTime) < 1439 ? timeFromMinutes(Math.min(minutes(task.startTime) + 60, 1439)) : '10:00')}
                onChange={(value) => edit(task.id, { endTime: value || null }, true)}
              />
            </div>
          </div>}
          {task.startTime && task.endTime && task.endTime <= task.startTime && (
            <p className="field-error" role="status">结束时间需要晚于开始时间。</p>
          )}
          <label className="inspector-field">
            <span>
              <CalendarDays size={15} />
              截止于
            </span>
            <DateInput
              label="截止于"
              value={task.dueDate ?? ''}
              onChange={(value) => edit(task.id, { dueDate: value || null }, true)}
            />
          </label>
          {!(task.startTime && task.endTime) && <label className="inspector-field">
            <span>
              <Clock3 size={15} />
              预计用时
            </span>
            <div className="estimate-input">
              <input
                type="number"
                aria-label="预计分钟数"
                min={1}
                max={100000}
                value={task.estimatedMinutes ?? ''}
                placeholder="—"
                onChange={(e) =>
                  edit(task.id, {
                    estimatedMinutes: e.target.value ? Number(e.target.value) : null
                  })
                }
                onBlur={() => void flush(task.id)}
              />
              <span>分钟</span>
            </div>
          </label>}
          {task.startTime && task.endTime && task.endTime > task.startTime && <p className="field-hint">安排时长 {minutes(task.endTime) - minutes(task.startTime)} 分钟</p>}
          <label className="inspector-field">
            <span><Flag size={15} />优先级</span>
            <select aria-label="优先级" value={task.priority} onChange={(e) => { const priority = priorities.find((p) => p === e.target.value); if (priority) edit(task.id, { priority }, true) }}>
              {priorities.map((p) => <option key={p} value={p}>{priorityLabels[p]}</option>)}
            </select>
          </label>
        </div>
        {(linkedPaper || linkedSubmission) && <div className="task-links"><span>关联来源</span>
          {linkedPaper && <div><button onClick={() => { useWorkbench.getState().setSection(linkedPaper.collection === 'publication' ? 'outputs' : 'literature'); if (linkedPaper.sourcePath) useLibrary.getState().openPaper(linkedPaper.id); else requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(linkedPaper.collection === 'publication' ? 'workbench:open-publication-record' : 'workbench:open-literature-record', { detail: linkedPaper.id }))) }}><FileText size={14} />{linkedPaper.title}</button><button aria-label="解除论文关联" title="解除关联；来源记录仍保留" onClick={() => edit(task.id, { linkedPaperId: null }, true)}><X size={13} /></button></div>}
          {linkedSubmission && <div><button onClick={() => { useWorkbench.getState().setSection('submissions'); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('workbench:open-submission-record', { detail: linkedSubmission.id }))) }}><Send size={14} />{linkedSubmission.title}</button><button aria-label="解除投稿关联" title="解除关联；来源记录仍保留" onClick={() => edit(task.id, { linkedSubmissionId: null }, true)}><X size={13} /></button></div>}
        </div>}
      </div>
      <div className="inspector-footer">
        <span className="save-state">
          {saving ? (
            <span className="tiny-spinner" />
          ) : dirty ? (
            <Circle size={12} />
          ) : (
            <Check size={13} />
          )}
          {saving ? '正在保存…' : dirty ? '尚未保存' : '已保存到本机'}
        </span>
        <Button
          variant="ghost"
          className="icon-button danger-text"
          aria-label="删除任务"
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={16} />
        </Button>
      </div>
      {saveError && !saving && (
        <>
          {task.title.trim() && !(task.startTime && task.endTime && task.endTime <= task.startTime) && (
            <p className="save-error-message field-error" role="status">{saveError}</p>
          )}
          <div className="save-recovery">
            <button onClick={() => void flush(task.id)}>重试保存</button>
            <button onClick={() => discard(task.id)}>撤销未保存的修改</button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        busy={deleting}
        title="删除此任务？"
        description="删除后无法恢复。"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setDeleting(true)
          const ok = await remove(task.id)
          if (!ok) setDeleting(false)
        }}
      />
    </motion.aside>
  )
}
