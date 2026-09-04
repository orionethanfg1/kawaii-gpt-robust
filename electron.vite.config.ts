import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkgVersion = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
).version as string

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@core': resolve('src/core')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@core': resolve('src/core'),
        '@shared': resolve('src/renderer/src/shared'),
        '@features': resolve('src/renderer/src/features')
      }
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion)
    }
  },
  // expose version to main via define as well
})
