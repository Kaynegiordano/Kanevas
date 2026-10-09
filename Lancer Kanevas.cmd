@echo off
rem Lance Kanevas (Electron). Premier lancement : installe les dependances si besoin.
cd /d "%~dp0"
if not exist node_modules\electron\package.json call npm install
if not exist node_modules\electron\dist\electron.exe node node_modules\electron\install.js
start "" "node_modules\electron\dist\electron.exe" "%~dp0." %*
