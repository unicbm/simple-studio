@echo off
setlocal

cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [Simple Studio] npm.cmd was not found in PATH.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [Simple Studio] cargo was not found in PATH.
  exit /b 1
)

if not exist "node_modules" (
  echo [Simple Studio] Installing frontend dependencies...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

echo [Simple Studio] Starting Rust API...
start "Simple Studio API" cmd /k cargo run --manifest-path src-tauri\Cargo.toml

echo [Simple Studio] Starting browser UI...
start "Simple Studio UI" cmd /k npm.cmd run dev

timeout /t 4 /nobreak >nul
start "" http://127.0.0.1:1420
exit /b 0
