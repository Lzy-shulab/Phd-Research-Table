import { Orbit, LockKeyhole, PanelLeft } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { DailyEncouragement } from './DailyEncouragement'
import { version } from '../../../../package.json'
import { useInterface } from '../../stores/interface'
export function Titlebar() {
  const errors = useWorkbench((s) => s.saveErrors)
  const firstError = Object.keys(errors)[0]
  const collapsed = useInterface((state) => state.preferences.sidebarCollapsed)
  const updateInterface = useInterface((state) => state.update)
  return (
    <header className="titlebar">
      <div className="app-brand">
        <button className="titlebar-sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => void updateInterface({ sidebarCollapsed: !collapsed })}><PanelLeft size={16} /></button>
        <Orbit size={19} strokeWidth={1.6} />
        <span>
          PhD <span className="brand-light">科研工作台</span>
        </span>
        <span className="version-badge">{version}</span>
      </div>
      <DailyEncouragement />
      <div className="titlebar-context">
        {firstError ? (
          <button
            className="danger-text"
            onClick={() => {
              useWorkbench.getState().setSection('planner')
              useWorkbench.getState().selectTask(firstError)
            }}
          >
            任务尚未保存 · 查看修改
          </button>
        ) : (
          <>
            <LockKeyhole size={11} />
            <span>本地工作区</span>
          </>
        )}
      </div>
    </header>
  )
}
