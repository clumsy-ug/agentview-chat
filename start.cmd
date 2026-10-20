@echo off
rem Open Agent View Chat (starts the local server in the background if needed). Details: README.md
rem node_modules is not in the repository, so the first run after cloning installs it
if exist "%~dp0node_modules\" goto open
where npm >nul 2>nul || goto open
echo Installing dependencies (first run only, takes a minute or two)...
pushd "%~dp0"
call npm ci --no-audit --no-fund
set "code=%errorlevel%"
popd
if not "%code%"=="0" (
  echo.
  echo npm ci failed. See the messages above.
  pause
  exit /b 1
)
:open
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\launch.ps1"
