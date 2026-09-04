import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts'
    ]
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/renderer/src/shared'),
      '@features': resolve(__dirname, 'src/renderer/src/features')
    }
  }
})
