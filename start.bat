@echo off
rem PONTO ZERO - inicia o servidor local e abre o jogo no Chrome/Edge (modo app).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
if not exist "vendor\three\three.module.js" (
  echo Preparando vendor...
  call npm install --no-audit --no-fund
  call node tools\vendor.mjs
)
node server\serve.mjs --open
