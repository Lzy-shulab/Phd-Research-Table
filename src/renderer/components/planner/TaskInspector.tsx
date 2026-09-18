import { useState } from 'react'
import { motion } from 'motion/react'
import {
  CalendarDays,
  Check,
  CheckCheck,
  Circle,
  Clock3,
  Flag,
  FolderOpen,
  Trash2,
  X
} from 'lucide-react'
import { priorityLabels } from '../../../shared/labels'
import { priorities, type Task } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { calendarLabel, minutes, timeFromMinutes } from '../../lib/dates'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/dialog'
import { DateInput } from '../ui/date-input'
import { TimeInput } from '../ui/time-input'

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
  const eligible = projects.filter((p) => !p.archivedAt || p.id === task.projectId)
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
          <label className="inspector-field">
            <span>
              <CalendarDays size={15} />
              计划日期
            </span>
            <DateInput
              label="计划日期"
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
          <div className="time-fields">
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
          </div>
          {!task.scheduledDate && (
            <p className="field-hint">先选择日期，再安排具体时间。</p>
          )}
          {task.startTime && task.endTime && task.endTime <= task.startTime && (
            <p className="field-error" role="status">结束时间需要晚于开始时间。</p>
          )}
          <label className="inspector-field">
            <span>
              <Flag size={15} />
              优先级
            </span>
            <select
              aria-label="优先级"
              value={task.priority}
              onChange={(e) => {
                const priority = priorities.find((p) => p === e.target.value)
                if (priority) edit(task.id, { priority }, true)
              }}
            >
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {priorityLabels[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="inspector-field">
            <span>
              <CalendarDays size={15} />
              截止日期
            </span>
            <DateInput
              label="截止日期"
              value={task.dueDate ?? ''}
              onChange={(value) => edit(task.id, { dueDate: value || null }, true)}
            />
          </label>
          <label className="inspector-field">
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
          </label>
        </div>
        <label className="field description-field">
          描述
          <textarea
            aria-label="任务描述"
            placeholder="记录任务背景、待解决的问题或下一步…"
            rows={6}
            maxLength={50000}
            value={task.description}
            onChange={(e) => edit(task.id, { description: e.target.value })}
            onBlur={() => void flush(task.id)}
          />
        </label>
        <div className="task-audit">
          <span>创建于 {calendarLabel(task.createdAt, 'yyyy年M月d日 · HH:mm')}</span>
          {task.completedAt && (
            <span>完成于 {calendarLabel(task.completedAt, 'M月d日 · HH:mm')}</span>
          )}
        </div>
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
