import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

function runtimeLicenseNotices() {
  return {
    name: 'khamlink-runtime-license-notices',
    apply: 'build' as const,
    generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: string }) => void }) {
      const notices = ['KhamLink frontend dependency notices. Corpus licensing is separate: see the source manifest and source panel.']
      for (const name of ['react', 'react-dom', 'scheduler', 'vite']) {
        const metadataPath = require.resolve(`${name}/package.json`)
        const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
        const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(file => join(dirname(metadataPath), file)).find(existsSync)
        if (!license) throw new Error(`Required license notice missing for ${name}`)
        notices.push(`${name}@${metadata.version}\n\n${readFileSync(license, 'utf8')}`)
      }
      this.emitFile({ type: 'asset', fileName: 'assets/THIRD_PARTY_NOTICES.txt', source: notices.join('\n\n--------------------\n\n') })
    },
  }
}

export default defineConfig({
  plugins: [react(), runtimeLicenseNotices()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
})
