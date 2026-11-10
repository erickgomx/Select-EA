@echo off
title Select Studio AI
cd /d "%~dp0"
call npm run electron:dev
pause
