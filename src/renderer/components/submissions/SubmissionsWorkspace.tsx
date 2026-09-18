import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import {
  Bell,
  BookOpenText,
  CalendarClock,
  Clock3,
  ListChecks,
  Plus,
  Search,
  Send
} from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Submission } from '../../../shared/types'
import { localDay } from '../../../shared/arxiv'
import { daysUntil, revisionReminder } from '../../../shared/submissions'
import { useSubmissions } from '../../stores/submissions'
import { useClock } from '../../hooks/use-clock'
import { Button } from '../ui/button'
import { SubmissionDialog } from './SubmissionDialog'

function stageDateLabel(date: string, today: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return year === Number(today.slice(0, 4)) ? `${month}月${day}日` : `${year}年${month}月${day}日`
}

function stageColor(index: number) {
  return `hsl(${(index * 67 + 206) % 360} 52% 58%)`
}

function SubmissionCard({
  submission,
  today,
  edit
}: {
  submission: Submission
  today: string
  edit: () => void
}) {
  const reduced = useReducedMotion()
  const due = submission.revisionDueDate ? daysUntil(submission.revisionDueDate, today) : null
  const count = submission.stages.length
  const timelineStyle = { '--stage-count': Math.max(1, count) } as CSSProperties
  return (
    <motion.article
      className="submission-card"
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      data-testid="submission-card"
    >
      <div className="submission-card-heading">
        <span
          className={`submission-status ${count ? '' : 'is-empty'}`}
          style={count ? ({ '--stage-color': stageColor(count - 1) } as CSSProperties) : undefined}
        >
          {count > 0 && <i className="submission-status-dot" aria-hidden="true" />}
          {submission.currentStage || '暂无状态'}
        </span>
        <span className="submission-journal" title={submission.journal}>
          <BookOpenText size={14} />
          <span>{submission.journal}</span>
        </span>
        <Button variant="ghost" onClick={edit} aria-label={`更新投稿 ${submission.title}`}>
          更新进展
        </Button>
      </div>
      <button className="submission-title" onClick={edit}>
        {submission.title}
      </button>
      <div className="submission-details">
        <div className="submission-key-detail">
          <span>
            <Send size={14} />
            投稿时间
          </span>
          <strong>
            {submission.submittedDate ? (
              <time dateTime={submission.submittedDate}>{submission.submittedDate}</time>
            ) : (
              '尚未投稿'
            )}
          </strong>
        </div>
        <div className="submission-key-detail submission-manuscript">
          <span>稿号</span>
          <strong>{submission.manuscriptId || '未填写'}</strong>
        </div>
        {due !== null && (
          <span
            className={`submission-deadline ${due < 0 ? 'overdue' : due <= submission.reminderDays ? 'approaching' : ''}`}
          >
            <CalendarClock size={13} />
            {due < 0 ? `返修逾期 ${-due} 天` : due === 0 ? '今天返修截止' : `返修还剩 ${due} 天`}
            <small>{submission.revisionDueDate}</small>
          </span>
        )}
      </div>
      {count ? (
        <div className="submission-timeline" style={timelineStyle}>
          {count > 1 && (
            <div
              className="submission-progress"
              role="progressbar"
              aria-label={`${submission.title} 已记录状态`}
              aria-valuemin={0}
              aria-valuemax={count}
              aria-valuenow={count}
              aria-valuetext={`已记录 ${count} 个状态`}
            >
              <motion.span
                initial={false}
                animate={{ scaleX: 1 }}
                transition={{ type: 'spring', bounce: 0, duration: reduced ? 0 : 0.45 }}
              />
            </div>
          )}
          <ol className="submission-stages" aria-label="已记录的投稿状态">
            {submission.stages.map((stage, index) => (
              <li
                className={`submission-stage ${index === count - 1 ? 'is-current' : ''}`}
                style={{ '--stage-color': stageColor(index) } as CSSProperties}
                key={stage.id}
                data-testid="submission-stage"
                aria-current={index === count - 1 ? 'step' : undefined}
              >
                <span className="submission-stage-name" title={stage.name}>
                  <i className="submission-status-dot" aria-hidden="true" />
                  {stage.name}
                </span>
                <time className="stage-date" dateTime={stage.occurredOn} title={stage.occurredOn}>
                  {stageDateLabel(stage.occurredOn, today)}
                </time>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="submission-empty-stage">暂无状态记录；添加后会从左侧依次形成时间线。</div>
      )}
      {submission.notes && (
        <p className="submission-notes" title={submission.notes}>
          {submission.notes}
        </p>
      )}
      <div className="submission-card-footer">
        <span>
          <ListChecks size={13} />
          阶段记录 · {count}
        </span>
        {submission.revisionDueDate && (
          <span>
            <Bell size={12} />
            {submission.reminderEnabled
              ? `提前 ${submission.reminderDays} 天提醒`
              : '未开启到期提醒'}
          </span>
        )}
      </div>
    </motion.article>
  )
}
export function SubmissionsWorkspace() {
  const state = useSubmissions()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [editing, setEditing] = useState<Submission | 'new' | null>(null)
  const today = localDay(useClock())
  const reminders = state.submissions.filter((item) => revisionReminder(item, today))
  const cards = state.submissions
    .filter(
      (item) =>
        (state.scope === null || (item.currentStage || '暂无状态') === state.scope) &&
        `${item.title} ${item.journal} ${item.manuscriptId} ${item.notes} ${item.stages.map((stage) => stage.name).join(' ')}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    )
    .sort((a, b) =>
      sort === 'deadline'
        ? (a.revisionDueDate ?? '9999').localeCompare(b.revisionDueDate ?? '9999')
        : sort === 'submitted'
          ? (b.submittedDate ?? '').localeCompare(a.submittedDate ?? '')
          : b.updatedAt.localeCompare(a.updatedAt)
    )
  const currentMonth = today.slice(0, 7)
  const stats = [
    {
      label: '累计投稿',
      value: state.submissions.filter((item) => item.stages.length > 0).length,
      unit: '次',
      icon: Send
    },
    {
      label: '本月进展',
      value: state.submissions.filter((item) =>
        item.stages.at(-1)?.occurredOn.startsWith(currentMonth)
      ).length,
      unit: '项',
      icon: Clock3
    },
    {
      label: '返修截止',
      value: state.submissions.filter((item) => item.revisionDueDate).length,
      unit: '项',
      icon: CalendarClock
    },
    {
      label: '阶段记录',
      value: state.submissions.reduce((sum, item) => sum + item.stages.length, 0),
      unit: '个',
      icon: ListChecks
    }
  ]
  return (
    <main className="submissions-workspace">
      <header className="workspace-header">
        <div>
          <div className="workspace-breadcrumb">
            论文投稿<span>/</span>
            {state.scope ?? '全部记录'}
          </div>
          <div className="heading-line">
            <h1>论文投稿</h1>
          </div>
          <p>记录每一次投稿，掌握接下来要做的事。</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          新增投稿
        </Button>
      </header>
      <div className="submissions-body">
        <div className="submission-stats">
          {stats.map(({ label, value, unit, icon: Icon }) => (
            <div key={label} className="submission-stat" data-testid={`stat-${label}`}>
              <span>
                <Icon size={16} />
                {label}
              </span>
              <strong>
                {value}
                <small>{unit}</small>
              </strong>
            </div>
          ))}
        </div>
        <div className="submission-count-note">
          状态名称和日期均由你填写；尚无状态的记录不计入累计投稿。
          {reminders.length > 0 && (
            <button
              onClick={() => {
                state.setScope(null)
                setSort('deadline')
              }}
            >
              <Bell size={13} />
              {reminders.length} 项返修临近截止或已逾期
            </button>
          )}
        </div>
        <div className="library-toolbar submission-toolbar">
          <label className="library-search">
            <Search size={16} />
            <input
              aria-label="搜索投稿记录"
              placeholder="搜索论文、期刊、稿号或备注"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="投稿记录排序"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated">最近更新</option>
            <option value="deadline">返修截止日期</option>
            <option value="submitted">最近投稿</option>
          </select>
        </div>
        {state.error ? (
          <div className="field-error" role="alert">
            {state.error}
            <Button onClick={() => void state.load()}>重试</Button>
          </div>
        ) : !state.loaded ? (
          <div className="empty-state">正在读取投稿记录…</div>
        ) : cards.length ? (
          <div className="submission-cards">
            {cards.map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                today={today}
                edit={() => setEditing(submission)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <Send size={27} strokeWidth={1.4} />
            </div>
            <h2>
              {state.submissions.length ? '这个范围还没有投稿记录。' : '从一篇正在投稿的论文开始。'}
            </h2>
            <p>期刊、审稿进展与返修期限，都可以记录在这里。</p>
            <Button onClick={() => setEditing('new')}>
              <Plus size={15} />
              新增投稿
            </Button>
          </div>
        )}
        <p className="submission-footnote">
          时间线只表示已记录的流程节点，不代表录用概率。系统提醒在应用运行时发送，重开后补查；关闭期间不发送。
        </p>
        {state.notificationError && (
          <p className="field-error" role="status">
            {state.notificationError}
          </p>
        )}
        {!state.notificationsSupported && reminders.length > 0 && (
          <p className="field-hint">当前系统通知不可用，返修截止事项仍显示在此页面。</p>
        )}
      </div>
      {editing && (
        <SubmissionDialog
          submission={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}
