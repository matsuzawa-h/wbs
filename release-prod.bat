@echo off
setlocal enableextensions
REM ============================================================
REM  WBS Web : production release   run on PROD machine TG120286
REM  Prereq  : C:\tmp\WbsWeb-deploy.zip is already placed here
REM  Run as ADMINISTRATOR. A full log is written under logs.
REM  If the zip is identical to the last successful release,
REM  the extract + swap steps are skipped automatically.
REM ============================================================

set "TASK=WbsWeb"
set "ZIP=C:\tmp\WbsWeb-deploy.zip"
set "STAGE=C:\tmp\WbsWeb-deploy"
set "APP=C:\Apps\WbsWeb"
set "DBPATH=C:\AppsData\WbsWeb\wbs.db"
set "DOCS=C:\AppsData\WbsWeb\docs"
set "STARTCMD=C:\AppsData\WbsWeb\start.cmd"
set "LOGDIR=C:\AppsData\WbsWeb\logs"
set "HASHFILE=C:\AppsData\WbsWeb\.release-zip.sha256"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" 2>nul
set "LOG=%LOGDIR%\release_%TS%.log"
echo ===== WBS Web release %TS% ===== > "%LOG%"
echo log file: %LOG%
echo tip - live tail: powershell -c "Get-Content '%LOG%' -Wait -Tail 20"
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] run this script as Administrator
  echo ===== RESULT: FAILED not-admin =====>> "%LOG%"
  exit /b 1
)
if not exist "%ZIP%" (
  echo [ERROR] not found: %ZIP%
  echo ===== RESULT: FAILED no-zip =====>> "%LOG%"
  exit /b 1
)

REM --- compare zip hash with last successful release ---
set "SKIPSWAP="
for /f %%h in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 '%ZIP%').Hash"') do set "ZIPHASH=%%h"
set "PREVHASH="
if exist "%HASHFILE%" set /p PREVHASH=<"%HASHFILE%"
echo zip sha256 : %ZIPHASH%>> "%LOG%"
echo prev sha256: %PREVHASH%>> "%LOG%"
if /i "%ZIPHASH%"=="%PREVHASH%" set "SKIPSWAP=1"
if defined SKIPSWAP if not exist "%APP%\dist\main.js" set "SKIPSWAP="
if defined SKIPSWAP (
  echo zip unchanged - extract/swap will be SKIPPED
) else (
  echo zip changed or new - will extract and swap
)

set "STEP=1of6 stop service and kill node"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
powershell -NoProfile -Command "Stop-ScheduledTask -TaskName '%TASK%' -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*WbsWeb\dist\main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >> "%LOG%" 2>&1
ping -n 4 127.0.0.1 >nul

set "STEP=2of6 extract zip to staging"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
if defined SKIPSWAP (
  echo   SKIPPED zip unchanged
  echo SKIPPED: zip unchanged>> "%LOG%"
) else (
  if exist "%STAGE%" rmdir /s /q "%STAGE%"
  mkdir "%STAGE%" 2>nul
  tar -xf "%ZIP%" -C "%STAGE%" >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [FAILED] %STEP% -- see %LOG%
    echo ===== RESULT: FAILED at %STEP% =====>> "%LOG%"
    exit /b 1
  )
)

set "STEP=3of6 swap app files keep logs"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
if defined SKIPSWAP (
  echo   SKIPPED zip unchanged
  echo SKIPPED: zip unchanged>> "%LOG%"
) else (
  robocopy "%STAGE%" "%APP%" /MIR /XD logs /R:2 /W:5 /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
  if %errorlevel% geq 8 (
    echo [FAILED] %STEP% robocopy %errorlevel% -- see %LOG%
    echo ===== RESULT: FAILED at %STEP% =====>> "%LOG%"
    exit /b 1
  )
  > "%HASHFILE%" echo %ZIPHASH%
  echo updated %HASHFILE%>> "%LOG%"
)

set "STEP=4of6 DB migration"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
set "DB_PATH=%DBPATH%"
cd /d "%APP%"
if errorlevel 1 (
  echo [FAILED] %STEP% APP missing
  echo ===== RESULT: FAILED at %STEP% =====>> "%LOG%"
  exit /b 1
)
if not exist "%APP%\node_modules\drizzle-kit\bin.cjs" (
  echo [FAILED] %STEP% : drizzle-kit not in deploy. Apply drizzle-kit dependencies fix then redeploy.
  echo ===== RESULT: FAILED at %STEP% no drizzle-kit =====>> "%LOG%"
  exit /b 1
)
node node_modules\drizzle-kit\bin.cjs migrate >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [FAILED] %STEP% -- see %LOG%
  echo ===== RESULT: FAILED at %STEP% =====>> "%LOG%"
  exit /b 1
)
set "DB_PATH="

set "STEP=5of6 start service"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
powershell -NoProfile -Command "Start-ScheduledTask -TaskName '%TASK%'" >> "%LOG%" 2>&1
ping -n 6 127.0.0.1 >nul
powershell -NoProfile -Command "Get-ScheduledTask -TaskName '%TASK%' | Get-ScheduledTaskInfo | Format-List TaskName,LastTaskResult,LastRunTime" >> "%LOG%" 2>&1

set "STEP=6of6 checks"
echo [%STEP%]
echo === %STEP% %DATE% %TIME% ===>> "%LOG%"
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5000 -ErrorAction SilentlyContinue) { 'port 5000 : LISTENING' } else { 'port 5000 : NOT LISTENING' }" > "%TEMP%\_wbs_port.txt" 2>&1
type "%TEMP%\_wbs_port.txt"
type "%TEMP%\_wbs_port.txt" >> "%LOG%"
del "%TEMP%\_wbs_port.txt" 2>nul
if not exist "%DOCS%\manual.html" (
  echo [WARN] %DOCS%\manual.html missing : /manual returns 404 - see release.html 4.6
  echo [WARN] docs missing>> "%LOG%"
)
if exist "%STARTCMD%" (
  findstr /I "MANUAL_DOCS_DIR" "%STARTCMD%" >nul
  if errorlevel 1 (
    echo [WARN] start.cmd has no MANUAL_DOCS_DIR : /manual returns 404 - see release.html 5.1
    echo [WARN] no MANUAL_DOCS_DIR>> "%LOG%"
  )
)
echo --- stderr.log tail --->> "%LOG%"
powershell -NoProfile -Command "if (Test-Path '%LOGDIR%\stderr.log') { Get-Content '%LOGDIR%\stderr.log' -Tail 15 } else { 'no stderr.log yet' }" >> "%LOG%" 2>&1

if defined SKIPSWAP (
  echo ===== RESULT: SUCCESS %TS% [swap skipped: zip unchanged] =====>> "%LOG%"
  echo [SUCCESS] released - extract/swap skipped: zip unchanged. log: %LOG%
) else (
  echo ===== RESULT: SUCCESS %TS% =====>> "%LOG%"
  echo [SUCCESS] released. log: %LOG%
)
echo  verify: http://localhost:5000/   /assignments   /manual   /downloads

endlocal
exit /b 0
