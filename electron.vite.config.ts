import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { main: resolve('src/main/main.ts'), 'migrate-workspace': resolve('src/main/migrate-workspace.ts') }, external: ['better-sqlite3'] } }
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'workbench-csp',
        transformIndexHtml(html, context) {
          // Vite's React refresh preamble is inline; only the dev server permits it.
          return context.server
            ? html.replace("script-src 'self' 'wasm-unsafe-eval';", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';")
            : html.replace("connect-src 'self' ws://127.0.0.1:*", "connect-src 'self'")
        }
      }
    ],
    server: { host: '127.0.0.1' },
    build: { minify: true, rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
