import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve(
  'test-results/current',
  executablePath ? 'ui-contrast-packaged' : 'ui-contrast'
)
mkdirSync(evidence, { recursive: true })
const tempRoot = realpathSync(tmpdir())
const profile = mkdtempSync(join(tempRoot, 'workbench-ui-contrast-'))
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE

const errors = []
let app
let page

const unwrap = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}

async function setWindowSize(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setBounds(bounds)
      window.showInactive()
    },
    { width, height }
  )
  await page.waitForTimeout(350)
}

async function inspectLayout() {
  return page.evaluate(() => {
    const encouragement = document.querySelector('.daily-encouragement')
    const titlebar = document.querySelector('.titlebar')
    const rows = [...document.querySelectorAll('.task-row')]
    const encouragementRect = encouragement.getBoundingClientRect()
    const titlebarRect = titlebar.getBoundingClientRect()
    const rowRects = rows.map((row) => row.getBoundingClientRect())
    const encouragementStyle = getComputedStyle(encouragement)
    const firstRowStyle = getComputedStyle(rows[0])
    return {
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      encouragement: {
        left: encouragementRect.left,
        right: encouragementRect.right,
        top: encouragementRect.top,
        bottom: encouragementRect.bottom,
        background: encouragementStyle.backgroundColor,
        color: encouragementStyle.color,
        borderWidth: encouragementStyle.borderTopWidth,
        backdropFilter: encouragementStyle.backdropFilter
      },
      titlebar: { left: titlebarRect.left, right: titlebarRect.right },
      tasks: {
        count: rows.length,
        gap: rowRects[1].top - rowRects[0].bottom,
        borderWidth: firstRowStyle.borderTopWidth,
        borderStyle: firstRowStyle.borderTopStyle
      },
      rootOverflow: document.documentElement.scrollWidth > innerWidth
    }
  })
}

try {
  app = await electron.launch(
    executablePath
      ? { executablePath: resolve(executablePath), args: [], env }
      : { args: ['.'], env }
  )
  page = await app.firstWindow()
  page.setDefaultTimeout(60_000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()

  const project = unwrap(
    await page.evaluate(() =>
      window.workbench.createProject({
        name: '光谱融合实验',
        description: '隔离界面验收项目',
        colorKey: 'blue'
      })
    )
  )
  for (const title of ['整理公开数据集', '复现实验基线']) {
    unwrap(
      await page.evaluate(
        ({ title, projectId }) => window.workbench.createTask({ title, projectId }),
        {
          title,
          projectId: project.id
        }
      )
    )
  }

  const wallpaperPath = join(profile, 'strong-background.png')
  const wallpaper = await app.evaluate(({ nativeImage, dialog }, path) => {
    const width = 1920
    const height = 1080
    const buffer = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        const band = Math.sin(x / 58) * 0.5 + 0.5
        const wave = Math.cos((x + y) / 83) * 0.5 + 0.5
        buffer[at] = 55 + Math.round(190 * band)
        buffer[at + 1] = 45 + Math.round(165 * wave)
        buffer[at + 2] = 65 + Math.round(155 * (1 - band))
        buffer[at + 3] = 255
      }
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    return nativeImage.createFromBitmap(buffer, { width, height }).toPNG().toString('base64')
  }, wallpaperPath)
  writeFileSync(wallpaperPath, Buffer.from(wallpaper, 'base64'))
  unwrap(await page.evaluate(() => window.workbench.uploadBackground()))
  unwrap(
    await page.evaluate(() => window.workbench.updateInterfacePreferences({ panelOpacity: 35 }))
  )
  unwrap(await page.evaluate(() => window.workbench.setAppearance('dark')))
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: /^全部任务/ })
    .click()
  await page.locator('.plan-note').filter({ hasText: '光谱融合实验' }).waitFor()
  await page.getByTestId('task-row').nth(1).waitFor()

  await page.getByRole('button', { name: '查看每日科研鼓励语', exact: true }).click()
  await page.getByRole('dialog', { name: '每日科研鼓励' }).waitFor()
  await page
    .getByRole('dialog', { name: '每日科研鼓励' })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.getByTestId('task-row').first().locator('.task-content').click()
  await page.getByRole('complementary', { name: '任务详情' }).waitFor()
  await page.getByRole('button', { name: '关闭任务详情', exact: true }).click()

  await setWindowSize(2048, 1104)
  const desktop = await inspectLayout()
  assert.equal(desktop.tasks.count, 2)
  assert.ok(desktop.tasks.gap >= 7.5 && desktop.tasks.gap <= 8.5, JSON.stringify(desktop.tasks))
  assert.ok(Number.parseFloat(desktop.tasks.borderWidth) >= 0.75, desktop.tasks.borderWidth)
  assert.equal(desktop.tasks.borderStyle, 'solid')
  assert.notEqual(desktop.encouragement.background, 'rgba(0, 0, 0, 0)')
  assert.ok(
    Number.parseFloat(desktop.encouragement.borderWidth) >= 0.75,
    desktop.encouragement.borderWidth
  )
  assert.match(desktop.encouragement.backdropFilter, /blur\(12px\)/)
  assert.ok(desktop.encouragement.left >= desktop.titlebar.left)
  assert.ok(desktop.encouragement.right <= desktop.titlebar.right)
  assert.equal(desktop.rootOverflow, false)
  await page.screenshot({
    path: join(evidence, 'strong-background-2048x1104.png'),
    animations: 'disabled',
    scale: 'css'
  })

  await setWindowSize(1100, 700)
  const minimum = await inspectLayout()
  assert.equal(minimum.rootOverflow, false)
  assert.ok(minimum.encouragement.left >= minimum.titlebar.left)
  assert.ok(minimum.encouragement.right <= minimum.titlebar.right)
  await page.screenshot({
    path: join(evidence, 'strong-background-minimum.png'),
    animations: 'disabled',
    scale: 'css'
  })

  assert.deepEqual(errors, [])
  writeFileSync(
    join(evidence, 'report.json'),
    JSON.stringify(
      {
        checks: [
          'Daily encouragement has an independent non-transparent blurred surface on a strong wallpaper.',
          'Task cards have a one-pixel full border and an eight-pixel inter-card gap.',
          'The titlebar and document remain within the viewport at 2048x1104 and the minimum window size.',
          'The encouragement dialog and task inspector still open and close from the updated controls.'
        ],
        desktop,
        minimum,
        errors,
        isolated: true,
        packaged: Boolean(executablePath),
        dataDirectory: profile
      },
      null,
      2
    )
  )
  console.log('ALL 4 UI CONTRAST CHECKS PASSED')
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: join(evidence, 'failure.png'), animations: 'disabled', scale: 'css' })
      .catch(() => undefined)
  }
  throw error
} finally {
  if (app) await app.close().catch(() => undefined)
  const target = realpathSync(profile)
  if (target.startsWith(`${tempRoot}\\`) && basename(target).startsWith('workbench-ui-contrast-')) {
    rmSync(target, { recursive: true, force: true })
  }
}
