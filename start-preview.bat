@echo off
rem CMU 3D - start the local preview server and open it in the default browser.
rem Close this window (or press Ctrl+C) to stop the server.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:5173
node tools\serve.mjs 5173
