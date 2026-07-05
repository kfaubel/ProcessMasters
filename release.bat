@echo off
setlocal EnableExtensions

if "%~1"=="" goto :usage
if /I not "%~1"=="major" if /I not "%~1"=="minor" if /I not "%~1"=="patch" goto :usage

set "BUMP=%~1"
set "SCRIPT_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%release.ps1" -Bump "%BUMP%"
exit /b %ERRORLEVEL%

:usage
echo Usage: %~nx0 major^|minor^|patch
exit /b 1