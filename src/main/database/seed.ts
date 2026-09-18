import { addDays, format } from 'date-fns'
import { TaskRepository } from './repositories/tasks'
import { ProjectRepository } from './repositories/projects'
import type { WorkbenchDatabase } from './db'

export function seedDevelopmentDatabase(db: WorkbenchDatabase): void {
  const projects = new ProjectRepository(db)
  const tasks = new TaskRepository(db)
  if (projects.list().length || tasks.list().length) return
  db.transaction(() => {
    const thesis = projects.create({
      name: '博士论文',
      description: '围绕博士论文推进问题梳理、阅读与研究。',
      colorKey: 'blue'
    })
    const cfssr = projects.create({
      name: 'CFSSR-Net',
      description: '面向高光谱图像重建的跨尺度融合研究。',
      colorKey: 'sage'
    })
    const today = format(new Date(), 'yyyy-MM-dd')
    tasks.create({
      title: '准备本周导师组会',
      projectId: thesis.id,
      scheduledDate: today
    })
    tasks.create({
      title: '回顾上次实验记录',
      projectId: cfssr.id,
      scheduledDate: today
    })
    const reading = tasks.create({
      title: '阅读近期 HSI 融合论文',
      projectId: thesis.id,
      scheduledDate: today,
      startTime: '09:17',
      endTime: '10:43'
    })
    tasks.update(reading.id, {
      description:
        '关注光谱保真度与跨尺度特征对齐。\n\n记录主要假设、评估数据集以及需要进一步研究的问题。',
      priority: 'medium',
      estimatedMinutes: 90
    })
    tasks.create({
      title: '修改方法部分',
      projectId: cfssr.id,
      scheduledDate: today,
      startTime: '11:00',
      endTime: '12:00'
    })
    tasks.create({
      title: '运行 Washington DC Mall 实验',
      projectId: cfssr.id,
      scheduledDate: today,
      startTime: '14:00',
      endTime: '16:00'
    })
    tasks.create({
      title: '对比重建误差图',
      projectId: cfssr.id,
      scheduledDate: format(addDays(new Date(), 2), 'yyyy-MM-dd'),
      startTime: '10:00',
      endTime: '11:00'
    })
    tasks.create({
      title: '安排下一轮消融实验',
      projectId: cfssr.id,
      scheduledDate: format(addDays(new Date(), 3), 'yyyy-MM-dd')
    })
    tasks.create({ title: '调研空间一致性指标', projectId: thesis.id })
    tasks.create({ title: '回顾光谱重建笔记', projectId: thesis.id })
    const done = tasks.create({
      title: '整理基线实验结果',
      projectId: cfssr.id
    })
    tasks.complete(done.id, true)
  })
}
