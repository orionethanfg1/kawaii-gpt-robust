# Abrir.ps1 — KawaiiGPT Robust (launcher all-in-one)
# Doble clic via Abrir.bat, o: pwsh -File .\Abrir.ps1
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot "launcher-log.txt"

function Log([string]$m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  Write-Host $line
  try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch {}
}

Clear-Host
Log "=== KawaiiGPT Robust ==="
Log "Launcher para usuarios: deja esta ventana abierta mientras usas la app."
Log "Si algo falla, el archivo launcher-log.txt guarda el historial."

Log "Carpeta: $PWD"
try {
  $pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
  Log "package.json version: $($pkg.version)"
  try {
    $vt = Get-Content ".\src\shared\version.ts" -Raw -ErrorAction SilentlyContinue
    if ($vt -match "APP_VERSION\s*=\s*'([^']+)'") {
      Log "UI APP_VERSION: $($Matches[1])"
      if ($Matches[1] -ne $pkg.version) {
        Log "AVISO: package.json ($($pkg.version)) != version.ts ($($Matches[1])). Copia src\ completo."
      }
    }
  } catch {}

  if ($pkg.version -match '^0\.5') {
    Log "AVISO: Esta copia del proyecto parece antigua (0.5.x)."
    Log "NO borres la carpeta: copia package.json + src\ nuevos y ejecuta Actualizar.ps1"
    Log "Lee LEEME-ACTUALIZAR.txt"
  }
} catch { Log "No se pudo leer version de package.json" }

# Forzar recompilacion limpia del main/preload/renderer
# Sanity: forge launcher code presente
if (Test-Path ".\src\main\forge-runtime.ts") {
  $fr = Get-Content ".\src\main\forge-runtime.ts" -Raw -ErrorAction SilentlyContinue
  if ($fr -notmatch "ensureKawaiiWebuiUser" -or $fr -notmatch "launch\.py") {
    Log "AVISO: src\main\forge-runtime.ts parece incompleto/antiguo. Copia src\main completo."
  } else {
    Log "forge-runtime.ts: OK (launcher endurecido)"
  }
} else {
  Log "ERROR: falta src\main\forge-runtime.ts"
}

Log "Limpiando compilado (out + cache vite) para forzar codigo actual..."
if (Test-Path ".\out") {
  try { Remove-Item -Recurse -Force ".\out" -ErrorAction SilentlyContinue } catch {}
}
if (Test-Path ".\node_modules\.vite") {
  try { Remove-Item -Recurse -Force ".\node_modules\.vite" -ErrorAction SilentlyContinue } catch {}
}



# 1) Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Log "ERROR: No se encontro Node.js."
  Log "Instala Node.js LTS desde https://nodejs.org y reinicia el PC."
  Read-Host "Enter para salir"
  exit 1
}
$nodeV = node -v 2>$null
$npmV = npm -v 2>$null
Log "Node $nodeV | npm $npmV"

if (-not (Test-Path ".\package.json")) {
  Log "ERROR: No hay package.json. Ejecuta este script dentro de la carpeta kawaii-gpt-robust."
  Read-Host "Enter para salir"
  exit 1
}

# 2) Dependencias
if (-not (Test-Path ".\node_modules\electron-vite")) {
  Log "Primera vez o faltan paquetes: npm install (5-15 min segun internet)."
  Log "No cierres esta ventana."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Log "ERROR: npm install fallo (codigo $LASTEXITCODE)."
    Log "Revisa red, antivirus o permisos y vuelve a intentar."
    Read-Host "Enter para salir"
    exit 1
  }
}

if (-not (Test-Path ".\node_modules\electron-vite")) {
  Log "ERROR: Tras npm install sigue faltando electron-vite."
  Log "Prueba: npm install electron-vite electron --save-dev"
  Read-Host "Enter para salir"
  exit 1
}
Log "electron-vite: OK"

# 3) Binario de Electron (postinstall / allow-scripts de npm 11+)
$electronDist = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronDist)) {
  Log "Binario de Electron no encontrado. Intentando rebuild..."
  try { npm approve-scripts electron 2>$null } catch {}
  try { npm approve-scripts esbuild 2>$null } catch {}
  npm rebuild electron
  if (-not (Test-Path $electronDist)) {
    Log "AVISO: electron.exe aun no esta. npm run dev puede descargarlo o fallar."
    Log "Si falla, ejecuta: npm approve-scripts electron ; npm rebuild electron"
  } else {
    Log "Electron: OK"
  }
} else {
  Log "Electron: OK"
}

# 4) Arranque en desarrollo (UI completa, HMR)
Log "Iniciando modo desarrollo..."
Log "Deja ESTA ventana abierta. Cierra la app o Ctrl+C aqui para salir."
Log "---"

npm run dev
$code = $LASTEXITCODE
Log "---"
Log "Proceso terminado. Codigo de salida: $code"
if ($code -ne 0) {
  Log "Si hubo error, copia este log (launcher-log.txt) y las lineas rojas de arriba."
}
Read-Host "Enter para cerrar"
