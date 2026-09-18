import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const target = resolve('src/renderer/public/pdfjs')
mkdirSync(target, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
  cpSync(resolve('node_modules/pdfjs-dist', directory), resolve(target, directory), { recursive: true })
