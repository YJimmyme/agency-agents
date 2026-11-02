@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

rem 埠號要和 Start.bat 一樣
if not defined PORTAL_PORT set "PORTAL_PORT=8000"

rem 只關掉在這個埠號上執行 serve_local.py 的程式，不會誤關其他程式
powershell -NoProfile -Command ^
  "$ids = @(Get-NetTCPConnection -State Listen -LocalPort %PORTAL_PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "if ($ids.Count -eq 0) { exit 1 };" ^
  "$other = $false;" ^
  "foreach ($id in $ids) {" ^
  "  $cmd = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id)).CommandLine;" ^
  "  if ($cmd -match 'serve_local\.py') { Stop-Process -Id $id -Force } else { $other = $true }" ^
  "};" ^
  "if ($other) { exit 2 } else { exit 0 }"
set "RC=%errorlevel%"

if "%RC%"=="0" (
  echo 員工入口已關閉。
  exit /b 0
)
if "%RC%"=="1" (
  echo 員工入口沒有在執行。
  exit /b 0
)
if "%RC%"=="2" (
  echo [警告] 埠號 %PORTAL_PORT% 被其他程式使用中，不是員工入口，所以沒有關閉它。
  exit /b 2
)
echo [錯誤] 關閉時發生問題（代碼 %RC%）。
exit /b %RC%
