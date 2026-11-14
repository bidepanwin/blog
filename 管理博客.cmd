@echo off
cd /d "%~dp0"
where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js and pnpm first.
  pause
  exit /b 1
)
call pnpm.cmd manage --open
pause
