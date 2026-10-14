import { FolderOpen } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'

export function ProjectSelect({ value, onChange, onCreate, label = '新计划所属项目', allowAutomatic = false }: {
  value: string, onChange: (value: string) => void, onCreate?: () => void, label?: string, allowAutomatic?: boolean
}) {
  const projects = useWorkbench((s) => s.projects).filter((p) => !p.archivedAt)
  const selected = projects.find((project) => project.id === value)
  return <label className={`capture-project project-${selected?.colorKey ?? 'slate'}`} title="每个研究计划都归属于一个项目">
    {selected ? <i className="project-dot" aria-hidden="true" /> : <FolderOpen size={15} />}
    <select aria-label={label} value={value} onChange={(event) => {
      if (event.target.value === '__create_project__') onCreate?.()
      else onChange(event.target.value)
    }} required={!allowAutomatic && projects.length > 0}>
      <option value="" disabled={!allowAutomatic}>{allowAutomatic ? '自动识别项目' : projects.length ? '选择项目' : '请先新建项目'}</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      {onCreate && <option value="__create_project__">新建项目…</option>}
    </select>
  </label>
}
