import { FolderOpen } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'

export function ProjectSelect({ value, onChange, label = '新计划所属项目', allowAutomatic = false }: {
  value: string, onChange: (value: string) => void, label?: string, allowAutomatic?: boolean
}) {
  const projects = useWorkbench((s) => s.projects).filter((p) => !p.archivedAt)
  return <label className="capture-project" title="每个研究计划都归属于一个项目">
    <FolderOpen size={15} />
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} required={!allowAutomatic}>
      <option value="" disabled={!allowAutomatic}>{allowAutomatic ? '自动识别项目' : projects.length ? '选择项目' : '请先新建项目'}</option>
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
  </label>
}
