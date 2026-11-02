@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

rem ================== 設定（可依需要修改，或在執行前先設好同名環境變數）==================
rem 模型名稱：要先用 ollama pull 下載過
if not defined PORTAL_MODEL set "PORTAL_MODEL=qwen3:8b"
rem 模型服務網址：Ollama 是 http://localhost:11434/v1，LM Studio 是 http://localhost:1234/v1
if not defined PORTAL_UPSTREAM set "PORTAL_UPSTREAM=http://localhost:11434/v1"
rem 網頁埠號
if not defined PORTAL_PORT set "PORTAL_PORT=8000"
rem 127.0.0.1 只有本機能用；0.0.0.0 讓區網其他電腦也能連
if not defined PORTAL_HOST set "PORTAL_HOST=127.0.0.1"
rem 啟動後自動打開瀏覽器：1 開，0 不開
if not defined PORTAL_OPEN_BROWSER set "PORTAL_OPEN_BROWSER=1"
rem 由這個腳本啟動 Ollama 時使用的上下文長度
if not defined OLLAMA_CONTEXT_LENGTH set "OLLAMA_CONTEXT_LENGTH=16384"
rem =====================================================================================

set "LOG=portal\serve_local.log"
set "URL=http://localhost:%PORTAL_PORT%"
set "PYTHONUTF8=1"

call :is_running
if not errorlevel 1 (
  echo 員工入口已經在執行中：%URL%
  goto :open
)

rem ---- 找 Python ----
set "PY="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  python -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo [錯誤] 找不到 Python。請到 https://www.python.org/downloads/ 安裝，安裝時勾選 Add python.exe to PATH。
  exit /b 1
)

rem ---- 使用 Ollama 時，確認它有在執行，沒有就幫忙啟動 ----
echo %PORTAL_UPSTREAM% | findstr /c:":11434" >nul
if not errorlevel 1 call :ensure_ollama

rem ---- 在背景啟動員工入口 ----
echo 啟動員工入口（模型 %PORTAL_MODEL%，服務 %PORTAL_UPSTREAM%）...
start "EmployeePortal" /min cmd /c "%PY% -u portal\scripts\serve_local.py --upstream %PORTAL_UPSTREAM% --model %PORTAL_MODEL% --host %PORTAL_HOST% --port %PORTAL_PORT% > "%LOG%" 2>&1"

for /l %%i in (1,1,20) do (
  call :is_running
  if not errorlevel 1 goto :started
  call :sleep1
)
echo [錯誤] 員工入口沒有啟動成功，以下是紀錄檔 %LOG% 的內容：
type "%LOG%" 2>nul
exit /b 1

:started
echo 員工入口已啟動：%URL%
echo 紀錄檔：%~dp0%LOG%
echo 要關閉請執行 Stop.bat

:open
if "%PORTAL_OPEN_BROWSER%"=="1" start "" "%URL%"
exit /b 0


rem ================== 副程式 ==================
:is_running
rem 有程式在監聽這個埠號就回傳 0
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %PORTAL_PORT% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
exit /b %errorlevel%

:ensure_ollama
curl -s -o nul -m 3 http://localhost:11434/api/version
if not errorlevel 1 (
  echo Ollama 已在執行。
  exit /b 0
)
where ollama >nul 2>&1
if errorlevel 1 (
  echo [警告] 連不到 Ollama，也找不到 ollama 指令。請先安裝並啟動 Ollama：https://ollama.com
  exit /b 0
)
echo 啟動 Ollama（上下文長度 %OLLAMA_CONTEXT_LENGTH%）...
start "Ollama" /min ollama serve
for /l %%i in (1,1,30) do (
  curl -s -o nul -m 2 http://localhost:11434/api/version
  if not errorlevel 1 exit /b 0
  call :sleep1
)
echo [警告] Ollama 30 秒內沒有回應，員工入口仍會啟動，但問問題可能會失敗。
exit /b 0

:sleep1
rem 不用 timeout 指令，因為由其他程式執行時它可能因為沒有鍵盤輸入而失敗
ping -n 2 127.0.0.1 >nul
exit /b 0
