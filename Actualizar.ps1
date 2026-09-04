# Actualizar KawaiiGPT Robust SIN borrar la carpeta ni reinstalar todo.
# Uso:
#   1) Descarga/copia los archivos NUEVOS encima de esta carpeta (o indica -Fuente).
#   2) Ejecuta:  pwsh -File .\Actualizar.ps1
# Conserva: node_modules, ajustes en AppData, modelos SD/Ollama, launcher-log.
# Limpia: out/ (compilado) para forzar codigo fresco.

param(
  [string]$Fuente = ""
)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$log = Join-Path $PSScriptRoot "launcher-log.txt"

function Log([string]$m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  Write-Host $line
  try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch {}
}

Clear-Host
Log "=== Actualizar KawaiiGPT (incremental) ==="
Log "Carpeta destino: $PWD"

if ($Fuente -and (Test-Path $Fuente)) {
  Log "Copiando desde: $Fuente"
  $exclude = @('node_modules', 'out', '.git', 'launcher-log.txt')
  Get-ChildItem -Path $Fuente -Force | ForEach-Object {
    if ($exclude -contains $_.Name) {
      Log "  (omitido) $($_.Name)"
      return
    }
    $dest = Join-Path $PWD $_.Name
    if ($_.PSIsContainer) {
      Log "  carpeta $($_.Name)/"
      Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
    } else {
      Log "  archivo $($_.Name)"
      Copy-Item -Path $_.FullName -Destination $dest -Force
    }
  }
} else {
  Log "Sin -Fuente: se asume que YA pegaste los archivos nuevos encima de esta carpeta."
}

# Archivos criticos de version
$crit = @(
  'src\main\forge-runtime.ts',
  'src\core\generative\intent.ts',
  'package.json',
  'src\shared\version.ts',
  'src\main\index.ts',
  'src\main\cloudflare-image.ts',
  'src\preload\index.ts'
)
Log "--- Comprobacion de archivos criticos ---"
$ok = $true
foreach ($c in $crit) {
  $p = Join-Path $PWD $c
  if (Test-Path $p) {
    Log "  OK  $c"
  } else {
    Log "  FALTA  $c"
    $ok = $false
  }
}

# Leer version
$verPkg = "?"
$verSrc = "?"
try {
  $pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
  $verPkg = $pkg.version
  Log "package.json version = $verPkg"
} catch { Log "ERROR leyendo package.json" }

try {
  $vt = Get-Content ".\src\shared\version.ts" -Raw
  if ($vt -match "APP_VERSION\s*=\s*'([^']+)'") { $verSrc = $Matches[1] }
  Log "src/shared/version.ts APP_VERSION = $verSrc"
} catch { Log "ERROR leyendo version.ts" }

if ($verPkg -ne $verSrc) {
  Log "AVISO: package.json ($verPkg) != version.ts ($verSrc). Algo no se copio bien."
  $ok = $false
}

if ($verPkg -match '^0\.5') {
  Log "ERROR: Sigue siendo 0.5.x. Los archivos NUEVOS no estan en esta carpeta."
  Log "Copia de nuevo package.json y toda la carpeta src\ desde el zip/descarga actualizada."
  Read-Host "Enter para salir"
  exit 1
}

# Limpiar solo compilado
if (Test-Path ".\out") {
  Log "Eliminando out/ (cache de compilacion)..."
  Remove-Item -Recurse -Force ".\out" -ErrorAction SilentlyContinue
}

# No tocamos node_modules salvo que falte electron-vite
if (-not (Test-Path ".\node_modules\electron-vite")) {
  Log "Falta electron-vite: npm install..."
  npm install
} else {
  Log "node_modules: se conserva (sin reinstalar todo)"
}

Log "---"
if ($ok) {
  Log "Listo. Version esperada en UI: v$verPkg"
  Log "Ahora ejecuta Abrir.bat y comprueba la esquina inferior izquierda."
} else {
  Log "Hubo avisos. Revisa los archivos FALTA / version desfasada arriba."
}
Log "=== RESULTADO ==="
Log "Si package.json y version.ts coinciden (ej. 0.7.0), ejecuta Abrir.bat"
Log "Si ves v0.6.1 en la esquina, NO se copió src/shared/version.ts — vuelve a pegar src\"
Read-Host "Enter para cerrar"
