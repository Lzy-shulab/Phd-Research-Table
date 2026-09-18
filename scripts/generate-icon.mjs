import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve('test-results', 'icon-profile') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor()
  const svg = readFileSync(resolve('resources/icon.svg'), 'utf8')
  const images = []
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const base64 = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image()
        image.src = `data:image/svg+xml;base64,${btoa(svg)}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        canvas.getContext('2d').drawImage(image, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg, size }
    )
    images.push({ size, buffer: Buffer.from(base64, 'base64') })
  }
  mkdirSync('resources', { recursive: true })
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, buffer }, i) => {
    const index = 6 + i * 16
    header[index] = size === 256 ? 0 : size
    header[index + 1] = header[index]
    header.writeUInt16LE(1, index + 4)
    header.writeUInt16LE(32, index + 6)
    header.writeUInt32LE(buffer.length, index + 8)
    header.writeUInt32LE(offset, index + 12)
    offset += buffer.length
  })
  writeFileSync('resources/icon.ico', Buffer.concat([header, ...images.map((i) => i.buffer)]))
  writeFileSync('resources/icon.png', images.at(-1).buffer)
  console.log('Generated Windows multi-resolution icon from resources/icon.svg')
} finally {
  await app.close()
}
