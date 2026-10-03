@echo off
chcp 65001 >nul
title KawaiiGPT Robust
cd /d "%~dp0"
echo Iniciando KawaiiGPT Robust...
where npm >nul 2>&1
if errorlevel 1 (
  echo No se encontro npm. Instala Node.js LTS.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
call npm run dev
if errorlevel 1 pause
