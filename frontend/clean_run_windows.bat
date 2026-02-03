@echo off

echo Cleaning build artifacts...
rd /s /q .next 2>nul
rd /s /q out 2>nul

echo Cleaning npm dependencies...
rd /s /q node_modules
del /f /q package-lock.json

echo Installing npm dependencies...
pnpm install

echo Building the project...
pnpm run tauri dev
