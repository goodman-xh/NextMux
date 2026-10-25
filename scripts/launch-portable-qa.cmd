@echo off
setlocal
for /f "delims=" %%F in ('dir /b /o-d "%~dp0..\apps\desktop\release\NextMux-*-x64-portable.exe" 2^>nul') do (
  start "NextMux Portable QA" "%~dp0..\apps\desktop\release\%%F" --remote-debugging-port=9444
  exit /b 0
)
echo No NextMux portable build was found.
exit /b 1
