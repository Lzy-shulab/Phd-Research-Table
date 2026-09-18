import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve(
  `test-results/current/submission-custom-${executablePath ? 'packaged' : 'development'}`
)
const dataDirectory = join(directory, `data-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: dataDirectory,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const unwrap = (value) => {
  assert.equal(value.ok, true, JSON.stringify(value))
  return value.data
}
const stageNames = [
  'Submitted to Journal',
  'With editor',
  'Editor invited',
  'Under review',
  'Required Reviews Completed',
  'Decision in Process',
  'Major Revision',
  'Revision Submitted',
  'Re-review',
  'Accepted'
]
const dates = [
  '2026-08-28',
  '2026-09-10',
  '2026-09-12',
  '2026-09-15',
  '2026-09-20',
  '2026-09-23',
  '2026-09-25',
  '2026-10-02',
  '2026-10-08',
  '2026-10-15'
]
const input = (count, title) => ({
  title,
  journal: 'Pattern Recognition',
  manuscriptId: `CUSTOM-${count}`,
  stages: stageNames.slice(0, count).map((name, index) => ({ name, occurredOn: dates[index] })),
  revisionDueDate: null,
  reminderEnabled: false,
  reminderDays: 3,
  notes: ''
})
let app
const errors = []
try {
  app = await electron.launch(
    executablePath
      ? { executablePath: resolve(executablePath), args: [], env }
      : { args: ['.'], env }
  )
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(1600, 1000)
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
  })
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.evaluate(
    ({ inputs }) =>
      Promise.all(
        inputs.map(async (item) => {
          const result = await window.workbench.createSubmission(item)
          if (!result.ok) throw new Error(result.error.message)
        })
      ),
    {
      inputs: [
        input(2, 'Two recorded states'),
        input(5, 'Five recorded states'),
        input(10, 'Ten recorded states'),
        input(0, 'No recorded state')
      ]
    }
  )
  await page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name: '论文投稿', exact: true })
    .click()
  await page.getByText('Two recorded states', { exact: true }).waitFor()
  const card = (title) => page.getByTestId('submission-card').filter({ hasText: title })
  assert.equal(await card('Two recorded states').getByTestId('submission-stage').count(), 2)
  assert.equal(await card('Five recorded states').getByTestId('submission-stage').count(), 5)
  assert.equal(await card('Ten recorded states').getByTestId('submission-stage').count(), 10)
  assert.equal(
    await card('No recorded state')
      .getByText(/暂无状态记录/)
      .count(),
    1
  )
  assert.match(
    await card('Two recorded states').getByTestId('submission-stage').first().textContent(),
    /Submitted to Journal.*8月28日/
  )
  assert.match(
    await card('Two recorded states').getByTestId('submission-stage').last().textContent(),
    /With editor.*9月10日/
  )
  const twoStageColors = await card('Two recorded states')
    .getByTestId('submission-stage')
    .locator('.submission-status-dot')
    .evaluateAll((dots) => dots.map((dot) => getComputedStyle(dot).backgroundColor))
  assert.equal(new Set(twoStageColors).size, 2)
  const currentDotColor = await card('Two recorded states')
    .locator('.submission-status .submission-status-dot')
    .evaluate((dot) => getComputedStyle(dot).backgroundColor)
  assert.equal(currentDotColor, twoStageColors.at(-1))
  const geometry = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.submission-card')).map((element) => {
      const title = element.querySelector('.submission-title')?.textContent
      const timeline = element.querySelector('.submission-timeline')?.getBoundingClientRect()
      const card = element.getBoundingClientRect()
      const stages = Array.from(element.querySelectorAll('.submission-stage')).map((stage) =>
        stage.getBoundingClientRect()
      )
      return {
        title,
        card: { x: card.x, width: card.width },
        timeline: timeline ? { x: timeline.x, width: timeline.width } : null,
        centers: stages.map((stage) => stage.x + stage.width / 2),
        overflow: element.scrollWidth - element.clientWidth
      }
    })
  )
  const byTitle = (title) => geometry.find((item) => item.title === title)
  const two = byTitle('Two recorded states'),
    five = byTitle('Five recorded states'),
    ten = byTitle('Ten recorded states'),
    empty = byTitle('No recorded state')
  assert.ok(
    two.timeline.width < five.timeline.width && five.timeline.width < ten.timeline.width,
    JSON.stringify({ two, five, ten })
  )
  assert.ok(Math.abs(two.timeline.x - (two.card.x + 23)) < 3)
  assert.equal(empty.timeline, null)
  const spacing = (item) => (item.centers.at(-1) - item.centers[0]) / (item.centers.length - 1)
  assert.ok(
    spacing(five) > spacing(ten),
    JSON.stringify({ five: spacing(five), ten: spacing(ten) })
  )
  assert.ok(
    geometry.every((item) => item.overflow <= 2),
    JSON.stringify(geometry)
  )
  for (const title of [
    'Two recorded states',
    'Five recorded states',
    'Ten recorded states',
    'No recorded state'
  ])
    await card(title).screenshot({
      path: join(directory, `${title.split(' ')[0].toLowerCase()}.png`),
      animations: 'disabled'
    })
  await card('Two recorded states')
    .getByRole('button', { name: /更新投稿 Two recorded states/ })
    .click()
  const dialog = page.getByRole('dialog')
  assert.equal(await dialog.getByLabel(/状态 \d+ 名称/).count(), 2)
  await dialog.getByRole('button', { name: '添加状态', exact: true }).click()
  await dialog.getByLabel('状态 3 名称').fill('Reviewer invited')
  await dialog.getByLabel('状态 3 日期').fill('2026-09-12')
  await dialog.screenshot({ path: join(directory, 'dialog.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '保存投稿记录', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await card('Two recorded states').getByTestId('submission-stage').count(), 3)
  assert.equal(
    await card('Two recorded states').locator('.submission-status').textContent(),
    'Reviewer invited'
  )
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 700)
  )
  await page.waitForTimeout(150)
  assert.equal(
    await page
      .locator('.submissions-workspace')
      .evaluate((element) => element.scrollWidth > element.clientWidth + 2),
    false
  )
  const snapshot = unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot()))
  assert.equal(
    snapshot.submissions.find((item) => item.title === 'Two recorded states').submittedDate,
    '2026-08-28'
  )
  assert.equal(
    snapshot.submissions.find((item) => item.title === 'Two recorded states').currentStage,
    'Reviewer invited'
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        checks: [
          '0/2/5/10 custom stages render without inferred placeholders',
          'explicit dates remain attached to names',
          'each state uses a distinct solid color and the current badge matches its timeline state',
          'timeline width grows with count and denser ten-stage spacing',
          'dialog appends and persists a new custom stage',
          '1100x700 viewport has no horizontal workspace overflow'
        ],
        geometry,
        dataDirectory,
        executablePath: executablePath ?? 'development',
        errors
      },
      null,
      2
    )
  )
  console.log('ALL 6 CUSTOM SUBMISSION CHECKS PASSED')
} finally {
  if (app) await app.close()
}
