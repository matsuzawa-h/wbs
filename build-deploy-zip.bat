@echo off
setlocal enableextensions
REM ============================================================
REM  WBS Web : build -> prod deploy -> zip -> copy to prod
REM  Run on DEV machine.
REM   - app zip  -> DEST       \\TG120286\tmp
REM   - docs      -> DOCSDEST   \\TG120286\C$\AppsData\WbsWeb\docs
REM  Step 1 pnpm install keeps the deploy consistent with
REM  package.json. Remove it only for offline/no-net builds.
REM ============================================================

set "REPO=c:\Git\WBS\WbsWeb"
set "DEPLOY=C:\tmp\WbsWeb-deploy"
set "ZIP=C:\tmp\WbsWeb-deploy.zip"
set "ZIPNAME=WbsWeb-deploy.zip"
set "DEST=\\TG120286\tmp"
set "APPSDATA=\\TG120286\C$\AppsData\WbsWeb"
set "DOCSDEST=\\TG120286\C$\AppsData\WbsWeb\docs"

cd /d "%REPO%"
if errorlevel 1 (
  echo [ERROR] repo not found: %REPO%
  exit /b 1
)

echo [1/9] pnpm install
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install failed
  exit /b 1
)

echo [2/9] web build
call pnpm --filter web build
if errorlevel 1 (
  echo [ERROR] web build failed
  exit /b 1
)

echo [3/9] copy web dist to api public
robocopy packages\web\dist packages\api\public /MIR /NFL /NDL /NJH /NJS
if %errorlevel% geq 8 (
  echo [ERROR] robocopy web to public failed
  exit /b 1
)

echo [4/9] api build
call pnpm --filter api build
if errorlevel 1 (
  echo [ERROR] api build failed
  exit /b 1
)

echo [5/9] pnpm prod deploy to %DEPLOY%
if exist "%DEPLOY%" rmdir /s /q "%DEPLOY%"
call pnpm --filter api --prod deploy "%DEPLOY%"
if errorlevel 1 (
  echo [ERROR] pnpm deploy failed
  exit /b 1
)
robocopy packages\api\public "%DEPLOY%\public" /MIR /NFL /NDL /NJH /NJS
if %errorlevel% geq 8 (
  echo [ERROR] robocopy public to deploy failed
  exit /b 1
)

echo [6/9] verify drizzle-kit is in the deploy
if not exist "%DEPLOY%\node_modules\drizzle-kit\bin.cjs" (
  echo [ERROR] drizzle-kit missing in deploy.
  echo         Ensure drizzle-kit is a dependency and pnpm install ran.
  exit /b 1
)
echo   OK drizzle-kit present

echo [7/9] zip to %ZIP%
if exist "%ZIP%" del /q "%ZIP%"
tar -a -c -f "%ZIP%" -C "%DEPLOY%" .
if errorlevel 1 (
  echo [ERROR] zip failed
  exit /b 1
)

echo [8/9] copy zip to %DEST%
if not exist "%DEST%\" (
  echo [ERROR] share not reachable: %DEST%  check power network permission
  exit /b 1
)
robocopy "C:\tmp" "%DEST%" "%ZIPNAME%" /R:2 /W:5 /NFL /NDL /NJH /NJS
if %errorlevel% geq 8 (
  echo [ERROR] copy to %DEST% failed
  exit /b 1
)

echo [9/9] sync docs to %DOCSDEST%
if not exist "%APPSDATA%\" (
  echo [ERROR] AppsData share not reachable: %APPSDATA%  check power network permission
  exit /b 1
)
robocopy "%REPO%\docs" "%DOCSDEST%" /MIR /R:2 /W:5 /NFL /NDL /NJH /NJS
if %errorlevel% geq 8 (
  echo [ERROR] docs sync to %DOCSDEST% failed
  exit /b 1
)

echo.
echo [DONE]
echo  local zip : %ZIP%
echo  remote zip: %DEST%\%ZIPNAME%
echo  docs sync : %DOCSDEST%
for %%F in ("%ZIP%") do echo  zip size  : %%~zF bytes
echo.
echo  On the production machine run release-prod.bat as Administrator.
echo  It extracts with tar and swaps into C:\Apps\WbsWeb, then migrates.
echo  /manual works because docs were synced to AppsData above.

endlocal
exit /b 0
