import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

const reactCompilerPresetForClient = reactCompilerPreset({ compilationMode: 'infer' })
const compilerFilter = (reactCompilerPresetForClient.rolldown.filter ??= {})
compilerFilter.id = { exclude: ['**/apps/api/**'] }

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tanstackRouter(),
    devtools(),
    tailwindcss(),
    viteReact(),
    babel({ presets: [reactCompilerPresetForClient] }),
  ],
  test: {
    // Unit/component tests live in src; e2e/ is Playwright's, not Vitest's.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // No component tests yet — this infra pass only wires up the test
    // runner. Prevents `vitest run` from failing CI on an empty suite.
    passWithNoTests: true,
    environment: 'jsdom',
  },
})

export default config
