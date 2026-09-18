import { setTimeout as delay } from 'node:timers/promises'

// Poll the resolved IPC result. Browser waitForFunction predicates treat a Promise as truthy.
export async function waitForAsync(page, predicate, arg, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate, arg)
    if (result) return result
    await delay(60)
  }
  throw new Error(`IPC condition did not become true within ${timeout} ms`)
}

export async function ensureTestProject(page) {
  const created = await page.evaluate(async () => {
    const snapshot = await window.workbench.bootstrap()
    if (!snapshot.ok) throw Error(snapshot.error.message)
    if (snapshot.data.projects.length) return false
    const result = await window.workbench.createProject({ name: '验收项目', description: '隔离验收数据', colorKey: 'blue' })
    if (!result.ok) throw Error(result.error.message)
    return true
  })
  if (created) {
    await page.reload()
    await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  }
}
