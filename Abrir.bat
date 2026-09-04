@echo off
cd /d "%~dp0"
title KawaiiGPT Robust
where pwsh >nul 2>&1
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0Abrir.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Abrir.ps1"
)
