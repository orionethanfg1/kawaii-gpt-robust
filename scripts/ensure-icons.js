/**
 * Ensures resources/icon.ico and icon.png exist before electron-builder.
 * On Windows, prefer: npm run icons (PowerShell kawaii face).
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'resources')
const ico = path.join(root, 'icon.ico')
const png = path.join(root, 'icon.png')

if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })

if (!fs.existsSync(ico) || !fs.existsSync(png)) {
  console.warn(
    '[package] Faltan iconos en resources/. Ejecuta "npm run icons" en Windows o deja los placeholders.'
  )
  process.exitCode = 0
} else {
  console.log('[package] Iconos OK:', ico, png)
}
