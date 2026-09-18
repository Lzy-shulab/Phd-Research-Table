import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const resultDir = resolve('test-results', `visual-${Date.now()}`)
mkdirSync(resultDir, { recursive: true })
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve(resultDir, 'demo-data') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.', '--seed-demo'], env })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => console.error('RENDERER ERROR', error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('button', { name: '浅色模式' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.screenshot({ path: resolve(resultDir, 'today-light.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '日历', exact: true }).click()
  await page.screenshot({ path: resolve(resultDir, 'week-light.png'), animations: 'disabled' })
  await page.getByTestId('schedule-block').first().click()
  await page.screenshot({ path: resolve(resultDir, 'inspector-light.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '深色模式' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.screenshot({ path: resolve(resultDir, 'week-dark.png'), animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 700 })
  )
  await page.screenshot({ path: resolve(resultDir, 'minimum-dark.png'), animations: 'disabled' })
  console.log(
    JSON.stringify(
      await page.evaluate(async () => ({
        data: await window.workbench.bootstrap(),
        nodeExposed: typeof window.require !== 'undefined'
      })),
      null,
      2
    )
  )
} finally {
  await app.close()
}
