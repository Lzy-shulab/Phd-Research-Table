import { motion } from 'motion/react'
import { Bot, Database, FolderCog, Monitor, Moon, Palette, Sun } from 'lucide-react'
import { appearanceLabels } from '../../../shared/labels'
import { modules, plannerViews } from '../../app/modules'
import { useWorkbench } from '../../stores/workbench'
import { useTasks } from '../../hooks/use-tasks'
import { useClock } from '../../hooks/use-clock'
import { dateKey } from '../../lib/dates'
import { cn } from '../../lib/utils'
import { MiniCalendar } from './MiniCalendar'
import { LibrarySidebar } from '../literature/LibrarySidebar'
import { OutputsSidebar } from '../outputs/OutputsSidebar'
import { SubmissionsSidebar } from '../submissions/SubmissionsSidebar'

export function Sidebar() {
  const section = useWorkbench((s) => s.section)
  const view = useWorkbench((s) => s.view)
  const navigate = useWorkbench((s) => s.navigate)
  const appearance = useWorkbench((s) => s.appearance)
  const setAppearance = useWorkbench((s) => s.setAppearance)
  const databasePath = useWorkbench((s) => s.databasePath)
  const tasks = useTasks()
  const now = useClock()
  const active = tasks.filter((t) => t.status !== 'completed')
  const module = modules.find((m) => m.id === section)!
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <span className="sidebar-module">
          <module.icon size={17} />
          {module.label}
        </span>
      </div>
      <div className="sidebar-scroll">
        {section === 'planner' ? (
          <>
            <nav className="planner-nav" aria-label="研究计划视图">
              {plannerViews.map((item) => {
                const count =
                  item.id === 'today'
                    ? active.filter(
                        (t) =>
                          t.scheduledDate === dateKey(now) ||
                          (!t.scheduledDate && t.dueDate === dateKey(now))
                      ).length
                    : item.id === 'all'
                      ? tasks.length
                      : null
                return (
                  <button
                    key={item.id}
                    className={cn('sidebar-link', view === item.id && 'selected')}
                    aria-current={view === item.id ? 'page' : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    {view === item.id && (
                      <motion.span className="nav-selection" layoutId="planner-view-selection" />
                    )}
                    <item.icon size={17} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {count !== null && count > 0 && <span className="nav-count">{count}</span>}
                  </button>
                )
              })}
            </nav>
            <MiniCalendar />
          </>
        ) : section === 'literature' ? (
          <LibrarySidebar />
        ) : section === 'outputs' ? (
          <OutputsSidebar />
        ) : section === 'submissions' ? (
          <SubmissionsSidebar />
        ) : (
          <>
            <nav aria-label="设置分类">
              <button
                className="sidebar-link"
                onClick={() =>
                  document.getElementById('appearance-settings')?.scrollIntoView({ block: 'start' })
                }
              >
                <Palette size={17} />
                <span>外观与显示</span>
              </button>
              <button
                className="sidebar-link"
                onClick={() =>
                  document.getElementById('assistant-settings')?.scrollIntoView({ block: 'start' })
                }
              >
                <Bot size={17} />
                <span>AI 助手</span>
              </button>
              <button
                className="sidebar-link"
                onClick={() =>
                  document.getElementById('storage-settings')?.scrollIntoView({ block: 'start' })
                }
              >
                <FolderCog size={17} />
                <span>文件保存</span>
              </button>
            </nav>
            <p className="sidebar-note">外观、AI 助手与文件位置，按你的习惯设置。</p>
          </>
        )}
      </div>
      <div className="sidebar-footer">
        <div className="local-status" title={databasePath}>
          <Database size={14} />
          <span>数据保存在本机</span>
          <span className="status-dot" />
        </div>
        <div className="appearance-row">
          <span>外观</span>
          <div className="appearance-switch" aria-label="外观">
            {(
              [
                { id: 'light', icon: Sun },
                { id: 'system', icon: Monitor },
                { id: 'dark', icon: Moon }
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                title={appearanceLabels[item.id]}
                aria-label={appearanceLabels[item.id]}
                aria-pressed={appearance === item.id}
                onClick={() => void setAppearance(item.id)}
                className={appearance === item.id ? 'selected' : ''}
              >
                <item.icon size={14} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
