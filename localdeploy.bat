@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "SOURCE_FILE=%SCRIPT_DIR%src\scripts\ProcessMasters.js"
set "DEST_DIR=C:\Program Files\PixInsight\src\scripts\local"
set "DEST_FILE=%DEST_DIR%\ProcessMasters.js"

net session >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  echo Error: localdeploy.bat must be run as Administrator.
  exit /b 1
)

if not exist "%SOURCE_FILE%" (
  echo Error: source file not found: "%SOURCE_FILE%"
  exit /b 1
)

if not exist "%DEST_DIR%" (
  echo Error: destination directory not found: "%DEST_DIR%"
  exit /b 1
)

copy /Y "%SOURCE_FILE%" "%DEST_FILE%" >nul
if errorlevel 1 (
  echo Error: failed to copy "%SOURCE_FILE%" to "%DEST_FILE%"
  exit /b 1
)

echo Deployed "%SOURCE_FILE%" to "%DEST_FILE%".
dir "%DEST_DIR%"
exit /b 0
