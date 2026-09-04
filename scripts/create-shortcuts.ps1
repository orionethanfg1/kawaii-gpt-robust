<#
.SYNOPSIS
  Crea accesos directos de KawaiiGPT Robust en el Escritorio.
#>

$Root    = Split-Path $PSScriptRoot -Parent
$ExePath = Join-Path $Root "dist\win-unpacked\KawaiiGPT Robust.exe"
$IcoPath = Join-Path $Root "resources\icon.ico"
$Desktop = [Environment]::GetFolderPath("Desktop")
$WShell  = New-Object -ComObject WScript.Shell

if (Test-Path $ExePath) {
    $lnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Robust.lnk")
    $lnk.TargetPath       = $ExePath
    $lnk.WorkingDirectory = Split-Path $ExePath
    if (Test-Path $IcoPath) { $lnk.IconLocation = "$IcoPath,0" }
    $lnk.Description      = "KawaiiGPT Robust (empaquetada)"
    $lnk.WindowStyle      = 1
    $lnk.Save()
    Write-Host "Acceso directo creado: $Desktop\KawaiiGPT Robust.lnk" -ForegroundColor Green
} else {
    Write-Host "No se encontro ejecutable en: $ExePath" -ForegroundColor Yellow
    Write-Host "Ejecuta primero: npm run package:dir   o   Empaquetar Windows.bat" -ForegroundColor Yellow
}

$devLnk = $WShell.CreateShortcut("$Desktop\KawaiiGPT Robust Dev.lnk")
$devLnk.TargetPath       = "cmd.exe"
$devLnk.Arguments        = "/k `"cd /d `"$Root`" && npm run dev`""
$devLnk.WorkingDirectory = $Root
if (Test-Path $IcoPath) { $devLnk.IconLocation = "$IcoPath,0" }
$devLnk.Description      = "KawaiiGPT Robust Dev (npm run dev)"
$devLnk.WindowStyle      = 1
$devLnk.Save()
Write-Host "Acceso directo dev creado: $Desktop\KawaiiGPT Robust Dev.lnk" -ForegroundColor Green
Write-Host ""
Write-Host "Listo." -ForegroundColor Cyan
